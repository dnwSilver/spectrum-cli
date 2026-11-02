const { fs, path, ensure, temporary, repositoryPath, stable, sha, COMMIT } = require("../automation");
const { projectPath, pages } = require("./runtime");
const { encoded } = require("../sbom/schema");
const { intersects } = require("./findings");
const { groupState, stateMarker, fileHashes } = require("./repair-plan");

const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const membersOf = (value) => value.members || [value];
function identity(value) {
  return value.group || {
    id: sha("task:" + value.task.key).slice(0, 16),
    keys: ["task:" + value.task.key], label: value.id,
  };
}
function descriptionFor(value, report, state, updates, previous = "") {
  const members = membersOf(value);
  const major = updates.filter((update) => update.major);
  const body = [
    stateMarker(state), "",
    "## Исправление", "", value.group?.label || value.id, "",
    "## Уязвимости и задачи", "",
    ...members.map((item) => `- ${item.id}: [${item.task.key}](${item.task.url}) · CVE: [${item.parent.key}](${item.parent.url})`),
    "", "Production audit после изменений выполнен. Новые HIGH/CRITICAL не обнаружены.",
    "Сборка и проверки проекта выполняются обычным CI/CD pipeline этой ветки; успешный аудит не подтверждает совместимость приложения.",
    "Автоматическое слияние отключено. Требуется ревью.",
    ...(major.length ? ["", "**Мажорные обновления зависимостей:**", ...major.map((update) => `- \`${update.package}\` → \`${update.version}\``), "Возможны несовместимые изменения API; проверить совместимость в CI и при ревью."] : []),
    "", `Исходный commit: \`${report.config.sha}\``, `Nightly pipeline: ${report.config.pipeline_url}`,
  ].join("\n");
  const managed = /<!-- spectrum-security-managed -->[\s\S]*?<!-- \/spectrum-security-managed -->/;
  const notes = managed.test(previous) ? previous.replace(managed, "").trim() : previous.trim();
  return "<!-- spectrum-security-managed -->\n" + body + "\n<!-- /spectrum-security-managed -->" + (notes ? "\n\n" + notes : "");
}
async function currentBranch(api, project, branch) {
  return api.get(project + "/repository/branches/" + encoded(branch));
}
async function verifyFiles(api, project, head, expected) {
  for (const [name, hash] of Object.entries(expected)) {
    const body = await api.get(project + "/repository/files/" + encoded(name) + "/raw", { raw: true, query: { ref: head } });
    ensure(sha(Buffer.from(body)) === hash, "Hotfix files differ from the bot snapshot; manual review required");
  }
}

async function repairGroup(repairer, api, value, report, root) {
  const cfg = report.config, project = projectPath(cfg.project_id);
  const group = identity(value);
  let members = membersOf(value);
  const matches = await pages(api, project + "/merge_requests", value.group
    ? { state: "opened", target_branch: cfg.branch, search: group.id }
    : { state: "opened", target_branch: cfg.branch, source_branch: "hotfix/" + value.task.key + "-security" });
  const owned = matches.filter((mr) => groupState(mr.description)?.id === group.id);
  ensure(owned.length <= 1, "Multiple MRs exist for this repair group");
  let mr = owned[0];
  // Existing per-task MRs are deliberately left intact. Do not make another MR
  // for the same tasks or overwrite a branch without an ownership snapshot.
  if (!mr) {
    const legacy = matches.filter((item) => !groupState(item.description));
    if (!value.group && legacy.length === 1) return { status: "existing", mr: legacy[0].web_url };
    const old = value.group ? await pages(api, project + "/merge_requests", { state: "opened", target_branch: cfg.branch }) : [];
    const related = old.filter((item) => members.some((member) => item.source_branch === "hotfix/" + member.task.key + "-security"));
    ensure(!related.length, "Existing per-task MRs require manual consolidation; no duplicate MR created: " + related.map((item) => item.web_url).join(", "));
  }
  const state = mr ? groupState(mr.description) : null;
  if (state) ensure(stable(state.keys) === stable(group.keys), "Repair group identity mismatch");
  let anchor = state?.primary || value.task.key;
  let branch = mr?.source_branch || "hotfix/" + anchor + "-security-" + group.id;
  const branches = (await pages(api, project + "/repository/branches", { search: mr ? "^" + escape(branch) + "$" : "-security-" + group.id + "$" }))
    .filter((item) => mr ? item.name === branch : new RegExp("^hotfix/.+-security-" + group.id + "$").test(item.name));
  ensure(branches.length <= 1, "Ambiguous hotfix branch");
  if (!mr && branches.length) {
    branch = branches[0].name;
    anchor = branch.slice("hotfix/".length, -("-security-" + group.id).length);
  }
  ensure(/^[A-Za-z0-9_-]+-\d+$/.test(anchor), "Invalid project task key for repair branch");
  const previous = branches[0]?.commit;
  if (mr) ensure(previous, "MR source branch is missing");
  ensure((await currentBranch(api, project, cfg.branch)).commit.id === cfg.sha, "Production branch moved after scan; rerun the nightly pipeline");
  if (state && previous.id === state.head) await verifyFiles(api, project, previous.id, state.files);

  return temporary("nightly-fix-", async (directory) => {
    const work = path.join(directory, "repo");
    repairer.run(["git", "clone", "--no-hardlinks", "--no-checkout", root, work]);
    repairer.run(["git", "checkout", "--detach", cfg.sha], work);
    const allowed = new Set(["package.json", "package-lock.json"]);
    const updates = value.sources.includes("npm") ? await repairer.fixNpm(work, value) : [];
    if (intersects(value.sources, ["runtime", "node"])) {
      await repairer.fixRuntime(work, value, report);
      allowed.add(report.runtime.dockerfile);
      if (repairer.env.NIGHTLY_RUNTIME_PUBLISH_VARIABLE) allowed.add(".gitlab-ci.yml");
    }
    let actions = repairer.commitActions(work, allowed);
    ensure(actions.length, "Repair produced no changes");
    if ((repairer.env.NIGHTLY_NPM_ENABLED || "true") === "true") {
      const [, after] = await repairer.auditNpm(work);
      const aliases = after.flatMap((item) => item.aliases);
      const baseline = new Set(report.findings.flatMap((item) => item.aliases));
      ensure(!intersects(aliases, value.aliases), "Target advisory remains after repair");
      ensure(!aliases.some((alias) => !baseline.has(alias)), "Repair introduced new HIGH/CRITICAL advisories");
      if (value.sources.includes("npm")) {
        const covered = report.findings.filter((item) => item.sources.every((source) => source === "npm") && !intersects(aliases, item.aliases));
        members = [...new Map([...members, ...covered].map((item) => [item.id, item])).values()];
      }
    }
    const fragment = ".changelog/" + anchor + ".security.md";
    ensure(!fs.existsSync(repositoryPath(work, fragment)), "Security changelog fragment already exists");
    actions.push({ action: "create", file_path: fragment, content: `- Устранены ${members.map((item) => item.id).sort().join(", ")}: ${group.label}.\n` });
    // When master has advanced, carry current master content into managed files
    // without force-pushing or deleting any branch history.
    if (state) for (const name of Object.keys(state.files)) {
      if (actions.some((action) => action.file_path === name)) continue;
      ensure(allowed.has(name), "Hotfix snapshot contains an unexpected file");
      actions.push({ action: "update", file_path: name, content: fs.readFileSync(repositoryPath(work, name)).toString("base64"), encoding: "base64" });
    }
    const hashes = fileHashes(actions);
    const message = `fix(${anchor}): remediate security group ${group.id}\n\nSpectrum-Security-Group: ${group.id}\nSpectrum-Security-Plan: ${sha(stable(hashes))}`;
    let head = previous?.id;
    let recovered = false;
    if (previous && (!state || previous.id !== state.head)) {
      // Recover a successful commit whose MR create/update response was lost.
      ensure(previous.message?.trim() === message && previous.parent_ids?.length === 1 && previous.parent_ids[0] === (state?.head || cfg.sha), "Hotfix branch was modified outside this workflow; manual review required");
      const diff = await pages(api, project + "/repository/commits/" + previous.id + "/diff");
      ensure(diff.every((item) => Object.hasOwn(hashes, item.new_path)), "Hotfix commit contains unexpected files");
      await verifyFiles(api, project, previous.id, hashes);
      recovered = true;
    }
    if (!recovered) {
      const changed = [];
      for (const action of actions) {
        if (state && state.files[action.file_path] === hashes[action.file_path]) continue;
        const next = { ...action };
        if (state || (value.group && action.action === "update")) {
          const meta = await api.get(project + "/repository/files/" + encoded(action.file_path), { query: { ref: previous?.id || cfg.sha } });
          ensure(COMMIT.test(meta.last_commit_id), "Cannot verify the previous file commit");
          next.action = "update";
          next.last_commit_id = meta.last_commit_id;
        }
        changed.push(next);
      }
      if (changed.length) {
        ensure((await currentBranch(api, project, cfg.branch)).commit.id === cfg.sha, "Production branch moved during repair; rerun");
        if (previous) ensure((await currentBranch(api, project, branch)).commit.id === previous.id, "Hotfix branch changed during repair; manual review required");
        const commit = await api.post(project + "/repository/commits", {
          branch, ...(!previous ? { start_sha: cfg.sha } : {}), commit_message: message, actions: changed,
        });
        ensure(COMMIT.test(commit.id), "Commit response has no valid SHA");
        if (value.group || (previous && commit.parent_ids))
          ensure(commit.parent_ids?.length === 1 && commit.parent_ids[0] === (previous?.id || cfg.sha), "Hotfix branch changed concurrently; review the preserved branch history");
        head = commit.id;
      }
    }
    ensure(COMMIT.test(head), "Cannot determine repair branch SHA");
    const nextState = { schema: 1, id: group.id, keys: group.keys, primary: anchor, base: state?.base || cfg.sha, scan: cfg.sha, head, files: hashes, cves: members.map((item) => item.id).sort() };
    const title = `Draft: 🚑 (${members.map((item) => item.task.key).sort().join(", ")}): ${group.label}`;

    if (!mr) {
      const raced = await pages(api, project + "/merge_requests", { state: "opened", source_branch: branch, target_branch: cfg.branch });
      ensure(raced.length <= 1, "Multiple MRs exist for the source branch");
      mr = raced[0];
    }
    const existed = Boolean(mr);
    if (mr?.iid) {
      const fresh = await api.get(project + "/merge_requests/" + mr.iid);
      if (state) ensure(groupState(fresh.description)?.head === state.head, "MR ownership metadata changed during repair; manual review required");
      ensure((await currentBranch(api, project, branch)).commit.id === head, "Hotfix branch changed before MR update; manual review required");
      mr = fresh;
    }
    const description = descriptionFor({ ...value, members }, report, nextState, updates, mr?.description || "");
    if (!mr) mr = await api.post(project + "/merge_requests", { source_branch: branch, target_branch: cfg.branch, title, description, remove_source_branch: true });
    else if (mr.title !== title || mr.description !== description)
      mr = await api.request("PUT", project + "/merge_requests/" + mr.iid, { title, description });
    if (value.group) ensure(Number.isInteger(mr.iid) && mr.iid > 0 && typeof mr.web_url === "string", "MR response is missing its IID or URL");
    return {
      status: existed ? (state?.head === head ? "existing" : "updated") : "created",
      mr: mr.web_url, mr_iid: mr.iid, sha: head, group: group.id, group_label: group.label,
      advisories: nextState.cves, tasks: members.map((item) => item.task.key),
      ...(updates.length ? { dependency_updates: updates } : {}),
    };
  });
}
module.exports = { repairGroup, descriptionFor, identity };

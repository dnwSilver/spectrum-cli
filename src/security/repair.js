const {
  fs,
  path,
  ensure,
  read,
  save,
  json,
  temporary,
  repositoryPath,
  equal,
} = require("../automation");
const { encoded } = require("../sbom/schema");
const { glab, pages, projectPath } = require("./runtime");
const { Scanner, runtimeFromDockerfile } = require("./scan");
const { intersects, trivyFindings, nodeFindings } = require("./findings");
const { formatReport, messageParts } = require("./report");
const {
  checkGitlabAccess,
  checkExecutables,
} = require("../preflight/automation");
const { isDryRun, isVerificationSkipped, reportPreflight } = require("../cli/command-executor");
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const pkgName = /^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+(?![\s\S])/;
const tuple = (value) => value.split(".").map(Number);
function compareTags(a, b) {
  const aa = tuple(a),
    bb = tuple(b);
  for (let i = 0; i < Math.max(aa.length, bb.length); i++) {
    if (i >= aa.length) return -1;
    if (i >= bb.length) return 1;
    if (aa[i] !== bb[i]) return aa[i] - bb[i];
  }
  return 0;
}
class Repairer extends Scanner {
  imageCandidates(image) {
    const base = image.split("@")[0],
      offset = base.lastIndexOf(":"),
      repository = base.slice(0, offset),
      tag = base.slice(offset + 1);
    ensure(
      offset !== -1 && !tag.includes("/"),
      "Runtime image must have an explicit tag",
    );
    if (/^\d+(?:\.\d+){2,3}(?![\s\S])/.test(tag)) {
      const tags = json(
        this.run(["skopeo", "list-tags", "docker://" + repository]).stdout,
      ).Tags;
      return tags
        .filter(
          (item) =>
            /^\d+(?:\.\d+){2,3}(?![\s\S])/.test(item) &&
            tuple(item)[0] === tuple(tag)[0] &&
            compareTags(item, tag) > 0,
        )
        .sort((a, b) => compareTags(b, a))
        .slice(0, 20)
        .map((item) => repository + ":" + item);
    }
    return [base];
  }
  async fixNpm(root, value) {
    const occurrences = value.occurrences.filter((entry) =>
      Object.hasOwn(entry, "entry"),
    );
    ensure(occurrences.length, "npm finding has no package evidence");
    const packages = [
      ...new Set(occurrences.map((entry) => entry.package)),
    ].sort();
    ensure(
      packages.every((name) => pkgName.test(name)),
      "Invalid npm package name",
    );
    this.run(
      [
        "npm",
        "update",
        "--package-lock-only",
        "--ignore-scripts",
        "--no-audit",
        "--",
        ...packages,
      ],
      root,
    );
    const [, remaining] = await this.auditNpm(root);
    if (remaining.some((item) => intersects(item.aliases, value.aliases))) {
      const fixes = Object.fromEntries(
        occurrences
          .filter((entry) => entry.fix && typeof entry.fix === "object")
          .map((entry) => [entry.fix.name, entry.fix]),
      );
      ensure(
        Object.keys(fixes).length,
        "No automatic compatible npm remediation is available",
      );
      for (const [name, fix] of Object.entries(fixes)) {
        ensure(
          !fix.isSemVerMajor,
          "Remediation requires a major dependency upgrade",
        );
        ensure(
          pkgName.test(name) && /^\d+\.\d+\.\d+(?![\s\S])/.test(fix.version),
          "Invalid npm remediation",
        );
        const manifest = read(path.join(root, "package.json"));
        ensure(
          Object.hasOwn(manifest.dependencies || {}, name) ||
            Object.hasOwn(manifest.optionalDependencies || {}, name),
          "Automatic manifest updates require a direct production dependency",
        );
        const flag = Object.hasOwn(manifest.optionalDependencies || {}, name)
          ? "--save-optional"
          : "--save-prod";
        this.run(
          [
            "npm",
            "install",
            "--package-lock-only",
            "--ignore-scripts",
            "--no-audit",
            "--save-exact",
            flag,
            "--",
            name + "@" + fix.version,
          ],
          root,
        );
      }
    }
  }
  async fixRuntime(root, value, report) {
    const runtime = report.runtime,
      candidates = this.imageCandidates(runtime.image);
    ensure(
      candidates.length,
      "No newer published runtime image; fix and publish the runtime owner first",
    );
    let selected,
      versions = [];
    const baseline = new Set(
      report.findings
        .filter((entry) => intersects(entry.sources, ["runtime", "node"]))
        .flatMap((entry) => entry.aliases),
    );
    for (let candidate of candidates) {
      candidate = this.immutableImage(candidate);
      if (candidate === runtime.image) continue;
      let safe = true;
      versions = [];
      for (const platform of runtime.platforms) {
        const [, entries, version] = await this.scanImage(candidate, platform),
          original = runtime[platform]?.node;
        if (
          original &&
          (!version || version.split(".")[0] !== original.split(".")[0])
        ) {
          safe = false;
          break;
        }
        const aliases = entries.flatMap((entry) => entry.aliases);
        if (
          intersects(aliases, value.aliases) ||
          aliases.some((alias) => !baseline.has(alias))
        ) {
          safe = false;
          break;
        }
        versions.push(version);
      }
      if (safe) {
        selected = candidate;
        break;
      }
    }
    ensure(selected, "No verified safe runtime candidate is published");
    const dockerfile = repositoryPath(root, runtime.dockerfile),
      text = fs.readFileSync(dockerfile, "utf8"),
      original = runtimeFromDockerfile(text);
    const regex = new RegExp(
      "^(FROM\\s+(?:--platform=\\S+\\s+)?)" + escape(original) + "(?=\\s|$)",
      "gim",
    );
    let count = 0;
    const changed = text.replace(regex, (_, prefix) => {
      count++;
      return prefix + selected;
    });
    ensure(
      count === 1,
      "Runtime FROM must be a single literal image for automatic replacement",
    );
    fs.writeFileSync(dockerfile, changed);
    const variable = this.env.NIGHTLY_RUNTIME_PUBLISH_VARIABLE;
    if (variable) {
      ensure(
        new Set(versions).size === 1 && versions[0],
        "Runtime platform versions differ",
      );
      const pipeline = repositoryPath(root, ".gitlab-ci.yml"),
        current = fs.readFileSync(pipeline, "utf8"),
        pattern = new RegExp(
          "^(  " +
            escape(variable) +
            ":\\s*)[\"']?(\\d+\\.\\d+\\.\\d+)\\.(\\d+)[\"']?[ \\t]*$",
          "m",
        );
      const match = current.match(pattern);
      ensure(match, "Cannot find runtime publication tag variable");
      const tag = versions[0] + "." + (Number(match[3]) + 1);
      fs.writeFileSync(
        pipeline,
        current.replace(pattern, (_, prefix) => prefix + '"' + tag + '"'),
      );
    }
    return selected;
  }
  commitActions(root, allowed) {
    const changed = this.run(["git", "diff", "--name-only", "-z"], root)
      .stdout.split("\0")
      .filter(Boolean);
    ensure(
      changed.every((file) => allowed.has(file)),
      "Repair modified files outside its permitted scope",
    );
    return changed.map((file) => {
      const target = repositoryPath(root, file);
      ensure(
        fs.lstatSync(target).isFile() && !fs.lstatSync(target).isSymbolicLink(),
        "Repair may only update regular files",
      );
      return {
        action: "update",
        file_path: file,
        content: fs.readFileSync(target).toString("base64"),
        encoding: "base64",
      };
    });
  }
  async repairOne(api, value, report, root) {
    const cfg = report.config,
      project = projectPath(cfg.project_id),
      branch = "hotfix/" + value.task.key + "-security";
    const existing = await pages(api, project + "/merge_requests", {
      state: "opened",
      source_branch: branch,
      target_branch: cfg.branch,
    });
    ensure(existing.length <= 1, "Multiple hotfix MRs exist for this task");
    if (existing.length) return { status: "existing", mr: existing[0].web_url };
    const branches = (
      await pages(api, project + "/repository/branches", {
        search: "^" + escape(branch) + "$",
      })
    ).filter((item) => item.name === branch);
    ensure(branches.length <= 1, "Ambiguous hotfix branch");
    const previous = branches[0]?.commit,
      expectedMessage = `fix(${value.task.key}): remediate ${value.id} [skip ci]`;
    if (previous)
      ensure(
        equal(previous.parent_ids, [cfg.sha]) &&
          previous.message?.trim() === expectedMessage,
        "Hotfix branch was modified outside this workflow; manual review required",
      );
    const head = await api.get(
      project + "/repository/branches/" + encoded(cfg.branch),
    );
    ensure(
      head.commit.id === cfg.sha,
      "Production branch moved after scan; rerun the nightly pipeline",
    );
    return temporary("nightly-fix-", async (directory) => {
      const work = path.join(directory, "repo");
      this.run(["git", "clone", "--no-hardlinks", "--no-checkout", root, work]);
      this.run(["git", "checkout", "--detach", cfg.sha], work);
      const allowed = new Set(["package.json", "package-lock.json"]);
      if (value.sources.includes("npm")) await this.fixNpm(work, value);
      if (intersects(value.sources, ["runtime", "node"])) {
        await this.fixRuntime(work, value, report);
        allowed.add(report.runtime.dockerfile);
        if (this.env.NIGHTLY_RUNTIME_PUBLISH_VARIABLE)
          allowed.add(".gitlab-ci.yml");
      }
      ensure(
        this.commitActions(work, allowed).length,
        "Repair produced no changes",
      );
      if ((this.env.NIGHTLY_NPM_ENABLED || "true") === "true")
        this.run(
          ["npm", "ci", "--ignore-scripts", "--no-audit", "--no-fund"],
          work,
        );
      const checks = json(this.env.NIGHTLY_CHECK_COMMANDS || "[]");
      ensure(
        Array.isArray(checks) &&
          checks.length &&
          checks.every(
            (check) =>
              Array.isArray(check) &&
              check.length &&
              check.every((arg) => typeof arg === "string"),
          ),
        "Configure nonempty check_commands as argv arrays",
      );
      for (const command of checks) this.run(command, work);
      const after = [];
      if ((this.env.NIGHTLY_NPM_ENABLED || "true") === "true") {
        const [, entries] = await this.auditNpm(work);
        after.push(...entries);
      }
      if (intersects(value.sources, ["runtime", "node"]))
        for (const platform of report.runtime.platforms) {
          const tag = "localhost/nightly-security:" + process.pid;
          this.run(
            [
              "buildah",
              "bud",
              "--isolation=chroot",
              "--platform",
              platform,
              "--format=docker",
              "--tag",
              tag,
              "--file",
              report.runtime.dockerfile,
              ".",
            ],
            work,
          );
          try {
            const archive = path.join(directory, "fixed-image.tar"),
              filename = path.join(directory, "fixed-trivy.json");
            this.run(["buildah", "push", tag, "docker-archive:" + archive]);
            this.run([
              "trivy",
              "image",
              "--input",
              archive,
              "--scanners",
              "vuln",
              "--severity",
              "HIGH,CRITICAL",
              "--skip-db-update=false",
              "--ignore-unfixed=false",
              "--ignorefile",
              "/dev/null",
              "--config",
              "/dev/null",
              "--format",
              "json",
              "--output",
              filename,
            ]);
            after.push(...trivyFindings(read(filename)));
            if ((this.env.NIGHTLY_CHECK_NODE || "true") === "true")
              after.push(
                ...nodeFindings(
                  this.nodeVersion(tag, platform),
                  await this.feed(),
                ),
              );
          } finally {
            this.run(["buildah", "rmi", tag]);
          }
        }
      const aliases = after.flatMap((entry) => entry.aliases),
        baseline = new Set(report.findings.flatMap((entry) => entry.aliases));
      ensure(
        !intersects(aliases, value.aliases),
        "Target advisory remains after repair",
      );
      ensure(
        !aliases.some((alias) => !baseline.has(alias)),
        "Repair introduced new HIGH/CRITICAL advisories",
      );
      const actions = this.commitActions(work, allowed),
        fragment = ".changelog/" + value.task.key + ".security.md";
      ensure(
        !fs.existsSync(repositoryPath(work, fragment)),
        "Security changelog fragment already exists",
      );
      actions.push({
        action: "create",
        file_path: fragment,
        content: `- Устранена ${value.id}: обновлены зависимости или runtime-образ.\n`,
      });
      const current = await api.get(
        project + "/repository/branches/" + encoded(cfg.branch),
      );
      ensure(
        current.commit.id === cfg.sha,
        "Production branch moved during repair; rerun",
      );
      if (previous) {
        const differences = await pages(
          api,
          project + "/repository/commits/" + previous.id + "/diff",
        );
        ensure(
          equal(
            new Set(differences.map((item) => item.new_path)),
            new Set(actions.map((action) => action.file_path)),
          ),
          "Existing hotfix commit has unexpected files",
        );
        for (const action of actions) {
          const expected =
              action.encoding === "base64"
                ? Buffer.from(action.content, "base64")
                : Buffer.from(action.content),
            actual = await api.get(
              project +
                "/repository/files/" +
                encoded(action.file_path) +
                "/raw",
              { raw: true, query: { ref: previous.id } },
            );
          ensure(
            Buffer.from(actual).equals(expected),
            "Existing hotfix differs from the verified repair",
          );
        }
      } else
        await api.post(project + "/repository/commits", {
          branch,
          start_sha: cfg.sha,
          commit_message: expectedMessage,
          actions,
        });
      const description = `Устранение ${value.id} (${value.severity}).\n\nЗадача: ${value.task.url}\nРодитель: ${value.parent.url}\n\nПроверки проекта и повторный аудит выполнены ночной автоматизацией.\nИсходный commit: \`${cfg.sha}\`\nPipeline: ${cfg.pipeline_url}\n\nАвтоматическое слияние отключено. Необходимо ревью.`;
      const mr = await api.post(project + "/merge_requests", {
        source_branch: branch,
        target_branch: cfg.branch,
        title: `Draft: 🚑 (${value.task.key}): устранение ${value.id}`,
        description,
        remove_source_branch: true,
      });
      return { status: "verified", mr: mr.web_url, checks, sha: cfg.sha };
    });
  }
  async preflightRepair(api, report, root) {
    const checks = json(this.env.NIGHTLY_CHECK_COMMANDS || "[]");
    ensure(
      Array.isArray(checks) &&
        checks.length &&
        checks.every(
          (command) =>
            Array.isArray(command) &&
            command.length &&
            command.every((arg) => typeof arg === "string"),
        ),
      "Configure nonempty check_commands as argv arrays",
    );
    const tools = new Set(["git"]);
    for (const value of report.findings) {
      ensure(value.task && value.parent, "YouTrack task was not resolved");
      if (value.sources.includes("npm")) {
        tools.add("npm");
        read(repositoryPath(root, "package.json"));
        read(repositoryPath(root, "package-lock.json"));
      }
      if (intersects(value.sources, ["runtime", "node"])) {
        for (const tool of ["skopeo", "trivy", "buildah"]) tools.add(tool);
        runtimeFromDockerfile(
          fs.readFileSync(
            repositoryPath(root, report.runtime.dockerfile),
            "utf8",
          ),
        );
      }
    }
    (this.deps.checkExecutables || checkExecutables)([...tools], this.env);
    const cfg = report.config;
    ensure(
      /^[a-f0-9]{40}(?![\s\S])/.test(cfg.sha),
      "Invalid source commit SHA",
    );
    const head = await api.get(
      projectPath(cfg.project_id) +
        "/repository/branches/" +
        encoded(cfg.branch),
    );
    ensure(
      head.commit.id === cfg.sha,
      "Production branch moved after scan; rerun the nightly pipeline",
    );
    this.run(["git", "cat-file", "-e", cfg.sha + "^{commit}"], root);
    reportPreflight(
      "security repair",
      "repair-inputs",
      "проверены задачи, инструменты, argv проверок и исходный commit",
    );
  }
  async repair(root = process.cwd(), { dry = isDryRun() } = {}) {
    const output = path.join(root, "security-report"),
      report = read(path.join(output, "tracked.json"));
    try {
      if (dry)
        ensure(
          !report.errors.length,
          "Incomplete scan/tracking; automatic repair is blocked",
        );
      if (!report.findings.length) return report.errors.length ? 1 : 0;
      ensure(
        !report.errors.length,
        "Incomplete scan/tracking; automatic repair is blocked",
      );
      const api = this.deps.api || glab(this.env);
      if (!isVerificationSkipped()) report.preflight = {
        ...report.preflight,
        gitlab_repair: await (this.deps.checkGitlabAccess || checkGitlabAccess)(
          this.env,
          [String(report.config.project_id)],
          { api, write: true },
        ),
      };
      if (dry) {
        await this.preflightRepair(api, report, root);
        return 0;
      }
      for (const value of report.findings) {
        try {
          ensure(value.task && value.parent, "YouTrack task was not resolved");
          ensure(
            !report.errors.length,
            "Incomplete scan/tracking; automatic repair is blocked",
          );
          value.repair = await this.repairOne(api, value, report, root);
        } catch (error) {
          value.repair = { status: "blocked", reason: error.message };
        }
      }
    } catch (error) {
      if (dry) throw error;
      report.errors.push(error.message);
      for (const value of report.findings)
        if (!value.repair)
          value.repair = { status: "blocked", reason: error.message };
    } finally {
      if (!dry) {
        save(path.join(output, "final.json"), report);
        save(path.join(output, "message.json"), {
          messages: messageParts(formatReport(report)),
        });
      }
    }
    return report.errors.length ||
      report.findings.some((value) => value.repair?.status === "blocked")
      ? 1
      : 0;
  }
}
module.exports = { Repairer, compareTags };

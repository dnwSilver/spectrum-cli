const { verifyCLI } = require("../automation/tooling");
const {
  fs,
  path,
  ensure,
  read,
  save,
  temporary,
  repositoryPath,
  equal,
} = require("../automation");
const { encoded } = require("../sbom/schema");
const {
  glab,
  pages,
  projectPath,
  diagnostic,
  logPhaseErrors,
} = require("./runtime");
const { Scanner, runtimeFromDockerfile } = require("./scan");
const { intersects } = require("./findings");
const { formatReport, messageParts } = require("./report");
const {
  checkGitlabAccess,
  checkExecutables,
} = require("../preflight/automation");
const {
  isDryRun,
  isVerificationSkipped,
  reportPreflight,
} = require("../cli/command-executor");
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
  async imageCandidates(image) {
    const base = image.split("@")[0],
      offset = base.lastIndexOf(":"),
      repository = base.slice(0, offset),
      tag = base.slice(offset + 1);
    ensure(
      offset !== -1 && !tag.includes("/"),
      "Runtime image must have an explicit tag",
    );
    if (/^\d+(?:\.\d+){2,3}(?![\s\S])/.test(tag)) {
      const tags = await this.registry.tags(image);
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
      candidates = await this.imageCandidates(runtime.image);
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
      candidate = await this.immutableImage(candidate);
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
    let changed = text.replace(regex, (_, prefix) => {
      count++;
      return prefix + selected;
    });
    ensure(
      count === 1,
      "Runtime FROM must be a single literal image for automatic replacement",
    );
    const variable = this.env.NIGHTLY_RUNTIME_PUBLISH_VARIABLE;
    if (variable) {
      ensure(
        new Set(versions).size === 1 && versions[0],
        "Runtime platform versions differ",
      );
      // Runtime owners must republish the version metadata lost when rebuilding
      // a distroless manifest. Application Dockerfiles keep their inherited config.
      const key = "com.google.distroless.nodejs.version";
      const label = 'LABEL ' + key + '="' + versions[0] + '"';
      const labelPattern = /^LABEL\s+com\.google\.distroless\.nodejs\.version=(?:"[^"]*"|'[^']*'|[^\s]+)[ \t]*$/gim;
      const labels = changed.match(labelPattern) || [];
      ensure(labels.length <= 1 && !changed.replace(labelPattern, "").includes(key),
        "Runtime version metadata requires a single dedicated LABEL instruction");
      changed = labels.length ? changed.replace(labelPattern, label) :
        changed.replace(/^(FROM[^\r\n]*)(\r?\n|$)/im, (_, line, newline) => line + (newline || "\n") + label + (newline || "\n"));
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
    fs.writeFileSync(dockerfile, changed);
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
      const after = [];
      if ((this.env.NIGHTLY_NPM_ENABLED || "true") === "true") {
        const [, entries] = await this.auditNpm(work);
        after.push(...entries);
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
            "Existing hotfix differs from the prepared repair",
          );
        }
      } else
        await api.post(project + "/repository/commits", {
          branch,
          start_sha: cfg.sha,
          commit_message: expectedMessage,
          actions,
        });
      const description = `Устранение ${value.id} (${value.severity}).\n\nЗадача: ${value.task.url}\nРодитель: ${value.parent.url}\n\nЗависимости или опубликованный runtime обновлены; повторный аудит соответствующего источника выполнен.\nСборка образа и проверки проекта в nightly не запускались. Требуется проверка в обычном MR pipeline.\nИсходный commit: \`${cfg.sha}\`\nPipeline: ${cfg.pipeline_url}\n\nАвтоматическое слияние отключено. Необходимо ревью.`;
      const mr = await api.post(project + "/merge_requests", {
        source_branch: branch,
        target_branch: cfg.branch,
        title: `Draft: 🚑 (${value.task.key}): устранение ${value.id}`,
        description,
        remove_source_branch: true,
      });
      return { status: "created", mr: mr.web_url, sha: cfg.sha };
    });
  }
  async preflightRepair(api, report, root) {
    const tools = new Set(["git"]);
    for (const value of report.findings) {
      ensure(value.task && value.parent, "YouTrack task was not resolved");
      if (value.sources.includes("npm")) {
        tools.add("npm");
        read(repositoryPath(root, "package.json"));
        read(repositoryPath(root, "package-lock.json"));
      }
      if (intersects(value.sources, ["runtime", "node"])) {
        for (const tool of ["trivy"]) tools.add(tool);
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
      "проверены задачи, инструменты и исходный commit",
    );
  }
  async repair(root = process.cwd(), { dry = isDryRun() } = {}) {
    const output = path.join(root, "security-report"),
      report = read(path.join(output, "tracked.json"));
    const blockedReason = () =>
      "Incomplete scan/tracking; automatic repair is blocked" +
      (report.errors.length
        ? ": " + diagnostic(report.errors.join("; "), this.env)
        : "");
    try {
      verifyCLI(report, this.env);
      if (dry) ensure(!report.errors.length, blockedReason());
      if (!report.findings.length) return report.errors.length ? 1 : 0;
      ensure(!report.errors.length, blockedReason());
      const api = this.deps.api || glab(this.env);
      if (!isVerificationSkipped())
        report.preflight = {
          ...report.preflight,
          gitlab_repair: await (
            this.deps.checkGitlabAccess || checkGitlabAccess
          )(this.env, [String(report.config.project_id)], { api, write: true }),
        };
      if (dry) {
        await this.preflightRepair(api, report, root);
        return 0;
      }
      for (const value of report.findings) {
        try {
          ensure(value.task && value.parent, "YouTrack task was not resolved");
          ensure(!report.errors.length, blockedReason());
          value.repair = await this.repairOne(api, value, report, root);
        } catch (error) {
          value.repair = {
            status: "blocked",
            reason: diagnostic(error.message, this.env),
          };
          console.error(
            "ERROR security repair [" +
              value.id +
              "]: " +
              diagnostic(error.message, this.env),
          );
        }
      }
    } catch (error) {
      if (dry) throw error;
      report.errors.push(diagnostic(error.message, this.env));
      for (const value of report.findings)
        if (!value.repair)
          value.repair = {
            status: "blocked",
            reason: diagnostic(error.message, this.env),
          };
    } finally {
      if (!dry) {
        logPhaseErrors("security repair", report, this.env);
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

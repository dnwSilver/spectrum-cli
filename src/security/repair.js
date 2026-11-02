const { verifyCLI } = require("../automation/tooling");
const { planRepairs } = require("./repair-plan");
const { repairGroup } = require("./grouped-repair");
const { queueTracking } = require("./tracking");
const {
  fs,
  path,
  ensure,
  read,
  save,
  repositoryPath,
} = require("../automation");
const { encoded } = require("../sbom/schema");
const {
  glab,
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
    const updates = [];
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
      const fixes = new Map();
      for (const entry of occurrences) {
        const fix = entry.fix;
        if (!fix || typeof fix !== "object") continue;
        ensure(pkgName.test(fix.name) && require("semver").valid(fix.version) === fix.version, "Invalid npm remediation");
        const previous = fixes.get(fix.name);
        if (!previous || require("semver").gt(fix.version, previous.version)) fixes.set(fix.name, fix);
      }
      ensure(
        fixes.size,
        "No automatic compatible npm remediation is available",
      );
      for (const [name, fix] of fixes) {
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
        updates.push({ package: name, version: fix.version, major: fix.isSemVerMajor === true });
      }
    }
    return updates;
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
    return repairGroup(this, api, value, report, root);
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
      let pending = [...report.findings];
      const linkErrors = [];
      while (pending.length) {
        const value = planRepairs(pending, root, report.runtime)[0];
        let result;
        try {
          ensure(value.members.every((item) => item.task && item.parent), "YouTrack task was not resolved");
          ensure(!report.errors.length, blockedReason());
          result = await this.repairOne(api, value, report, root);
          if (result.mr_iid) {
            try {
              const linked = await (this.deps.publishRepairLinks || queueTracking)(report,
                { ...this.env, NIGHTLY_SCAN_JOB_ID: report.config.scan_job_id || this.env.NIGHTLY_SCAN_JOB_ID },
                this.deps, { repairMR: result.mr_iid });
              ensure(!linked.errors.length, "YouTrack MR links were not fully updated");
              result.youtrack_links = "updated";
            } catch (error) {
              result.youtrack_links = "blocked";
              result.reason = "MR created; YouTrack links: " + diagnostic(error.message, this.env);
              linkErrors.push(result.reason);
            }
          }
        } catch (error) {
          result = { status: "blocked", reason: diagnostic(error.message, this.env), group: value.group.id, group_label: value.group.label };
          console.error("ERROR security repair [" + value.members.map((item) => item.id).join(", ") + "]: " + diagnostic(error.message, this.env));
        }
        const covered = new Set(result.advisories || value.members.map((item) => item.id));
        for (const member of report.findings) if (covered.has(member.id)) member.repair = structuredClone(result);
        pending = pending.filter((item) => !covered.has(item.id));
      }
      report.errors.push(...linkErrors);

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

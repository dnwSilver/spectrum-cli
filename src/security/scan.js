const {
  fs,
  path,
  ensure,
  read,
  save,
  json,
  temporary,
  temp,
  remove,
  repositoryPath,
  DIGEST,
} = require("../automation");
const { run, API, diagnostic } = require("./runtime");
const {
  npmFindings,
  trivyFindings,
  nodeFindings,
  mergeFindings,
} = require("./findings");
const { required, checkExecutables } = require("../preflight/automation");
const { isDryRun, reportPreflight } = require("../cli/command-executor");
const NODE_FEED = "nodejs/security-wg/main/vuln/core/index.json";
function runtimeFromDockerfile(text) {
  const args = {},
    stages = {};
  let last;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (/^ARG /i.test(line) && !Object.keys(stages).length) {
      const match = line.slice(4).match(/^([^=]+)(?:=(.*))?(?![\s\S])/);
      args[match[1]] = (match[2] || "").replace(/^["']|["'](?![\s\S])/g, "");
    }
    if (!/^FROM /i.test(line)) continue;
    // FROM accepts only literal images/aliases/global ARGs. No shell evaluation.
    const parts =
      line
        .replace(/\s+#.*(?![\s\S])/, "")
        .match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
    const offset = parts[1]?.startsWith("--platform=") ? 2 : 1;
    let image = (parts[offset] || "")
      .replace(/^["']|["'](?![\s\S])/g, "")
      .replace(
        /\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g,
        (_, a, b) => args[a || b] ?? "$UNRESOLVED",
      );
    ensure(
      image && !image.includes("$") && image !== "scratch",
      "Runtime FROM cannot be resolved safely",
    );
    last = stages[image.toLowerCase()] || image;
    const alias =
      parts[offset + 1]?.toUpperCase() === "AS" && parts[offset + 2]
        ? parts[offset + 2].toLowerCase()
        : String(Object.keys(stages).length);
    stages[alias] = last;
  }
  ensure(last, "No runtime FROM found");
  return last;
}
function skopeoImageReference(image) {
  const at = image.indexOf("@");
  if (at === -1) return image;
  const name = image.slice(0, at),
    digest = image.slice(at + 1);
  ensure(DIGEST.test(digest), "Invalid runtime image digest");
  const colon = name.lastIndexOf(":"),
    slash = name.lastIndexOf("/");
  // Strip the tag, never the registry port. Keep the original tag in report metadata.
  return (colon > slash ? name.slice(0, colon) : name) + "@" + digest;
}
class Scanner {
  constructor(env = process.env, deps = {}) {
    this.env = env;
    this.deps = deps;
  }
  run(args, cwd, options) {
    return (this.deps.run || run)(args, cwd, options, this.env);
  }
  async auditNpm(root, evidence) {
    const proc = this.run(
      [
        "npm",
        "audit",
        "--registry=https://registry.npmjs.org/",
        "--omit=dev",
        "--audit-level=high",
        "--json",
      ],
      root,
      { allowed: [0, 1] },
    );
    if (evidence)
      save(evidence.replace(/\.json$/, "-command.json"), {
        status: proc.status,
        stderr: diagnostic(proc.stderr, this.env),
      });
    let report;
    try {
      report = json(proc.stdout);
    } catch {
      throw new Error(
        "npm audit returned invalid JSON" +
          (proc.stderr ? ": " + diagnostic(proc.stderr, this.env) : ""),
      );
    }
    if (evidence) save(evidence, report);
    if (!report || report.error || !report.vulnerabilities) {
      const code = report?.statusCode || report?.error?.code || proc.status;
      const detail = diagnostic(
        report?.message ||
          report?.error?.summary ||
          report?.error?.detail ||
          proc.stderr,
        this.env,
      );
      throw new Error(
        `npm audit returned no vulnerability report (${code})${detail ? ": " + detail : ""}`,
      );
    }
    const values = await npmFindings(report, this.deps.aliases);
    ensure(
      proc.status === 0 || values.length,
      "npm audit failed without HIGH/CRITICAL findings",
    );
    return [report, values];
  }
  immutableImage(image) {
    const digest = this.run([
      "skopeo",
      "inspect",
      "--format",
      "{{.Digest}}",
      "docker://" + skopeoImageReference(image),
    ]).stdout.trim();
    ensure(DIGEST.test(digest), "Registry did not return an image digest");
    return image.split("@")[0] + "@" + digest;
  }
  nodeVersion(image, platform) {
    ensure(
      ["linux/amd64", "linux/arm64"].includes(platform),
      "Unsupported runtime platform",
    );
    const directory = temp("nightly-node-");
    const imagePath = path.join(directory, "image");
    const bundle = path.join(directory, "bundle");
    let failure;
    try {
      this.run([
        "skopeo",
        "--override-os",
        "linux",
        "--override-arch",
        platform.split("/")[1],
        "copy",
        "docker://" + skopeoImageReference(image),
        "oci:" + imagePath + ":runtime",
      ]);
      this.run([
        "umoci",
        "unpack",
        "--rootless",
        "--image",
        imagePath + ":runtime",
        bundle,
      ]);
      const binary = this.env.NIGHTLY_NODE_BINARY || "/nodejs/bin/node";
      ensure(
        path.posix.isAbsolute(binary) && !binary.split("/").includes(".."),
        "Expected an absolute runtime Node binary path",
      );
      // Execute only the runtime binary, with its own libraries and an unprivileged uid.
      // This does not need a container daemon, mount namespace or Buildah storage.
      const value = this.run([
        "chroot",
        "--userspec=65534:65534",
        path.join(bundle, "rootfs"),
        binary,
        "--version",
      ])
        .stdout.trim()
        .replace(/^v/, "");
      ensure(
        /^\d+\.\d+\.\d+(?![\s\S])/.test(value),
        "Cannot determine runtime Node.js version",
      );
      return value;
    } catch (error) {
      failure = error;
      throw error;
    } finally {
      try {
        remove(directory);
      } catch (cleanup) {
        if (failure) failure.message += "; cleanup: " + cleanup.message;
        else throw cleanup;
      }
    }
  }
  async feed() {
    return this.deps.feed
      ? this.deps.feed()
      : new API("https://raw.githubusercontent.com").get(NODE_FEED);
  }
  async scanImage(image, platform, feed, evidence) {
    ensure(
      ["linux/amd64", "linux/arm64"].includes(platform),
      "Unsupported runtime platform",
    );
    const report = await temporary("nightly-trivy-", async (dir) => {
      const filename = path.join(dir, "report.json");
      this.run([
        "trivy",
        "image",
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
        "--platform",
        platform,
        "--format",
        "json",
        "--output",
        filename,
        image,
      ]);
      return read(filename);
    });
    if (evidence) save(evidence, report);
    const values = trivyFindings(report);
    let version = null;
    if ((this.env.NIGHTLY_CHECK_NODE || "true") === "true") {
      version = this.nodeVersion(image, platform);
      feed = feed || (await this.feed());
      ensure(
        feed && Object.keys(feed).length,
        "Empty Node.js vulnerability feed",
      );
      values.push(...nodeFindings(version, feed));
    }
    return [report, mergeFindings(values), version];
  }
  config() {
    const e = this.env;
    for (const key of [
      "CI_PROJECT_ID",
      "CI_PROJECT_PATH",
      "CI_COMMIT_SHA",
      "CI_PIPELINE_ID",
      "CI_PIPELINE_URL",
      "CI_JOB_ID",
    ])
      ensure(e[key], key + " is required");
    return {
      project_id: e.CI_PROJECT_ID,
      project_path: e.CI_PROJECT_PATH,
      sha: e.CI_COMMIT_SHA,
      branch: e.NIGHTLY_MAIN_BRANCH || "master",
      youtrack_project: e.NIGHTLY_YOUTRACK_PROJECT || "",
      subsystem: e.NIGHTLY_YOUTRACK_SUBSYSTEM || "",
      time_article: e.NIGHTLY_YOUTRACK_TIME_TRACKING_ARTICLE || "",
      tester: e.NIGHTLY_YOUTRACK_TESTER || "",
      pipeline_id: e.CI_PIPELINE_ID,
      pipeline_url: e.CI_PIPELINE_URL,
    };
  }
  async preflight(root) {
    this.config();
    required(this.env, [
      "NIGHTLY_YOUTRACK_PROJECT",
      "NIGHTLY_YOUTRACK_TIME_TRACKING_ARTICLE",
      "NIGHTLY_YOUTRACK_TESTER",
    ]);
    const tools = ["trivy", "skopeo"];
    if ((this.env.NIGHTLY_NPM_ENABLED || "true") === "true") {
      ensure(
        fs.statSync(repositoryPath(root, "package-lock.json")).isFile(),
        "package-lock.json is required",
      );
      read(repositoryPath(root, "package-lock.json"));
      tools.push("npm");
    }
    if ((this.env.NIGHTLY_CHECK_NODE || "true") === "true")
      tools.push("umoci", "chroot");
    (this.deps.checkExecutables || checkExecutables)(tools, this.env);
    const platforms = (this.env.NIGHTLY_PLATFORMS || "linux/amd64").split(",");
    ensure(
      platforms.length &&
        platforms.every((platform) =>
          ["linux/amd64", "linux/arm64"].includes(platform),
        ),
      "Unsupported runtime platform",
    );
    const dockerfile = repositoryPath(
      root,
      this.env.NIGHTLY_DOCKERFILE || "build/Dockerfile",
    );
    this.immutableImage(
      runtimeFromDockerfile(fs.readFileSync(dockerfile, "utf8")),
    );
    reportPreflight(
      "security scan",
      "scan-inputs",
      "проверены настройки, файлы, инструменты и доступ к runtime-образу",
    );
  }
  async scan(root = process.cwd(), { dry = isDryRun() } = {}) {
    if (dry) {
      await this.preflight(root);
      return 0;
    }
    const output = path.join(root, "security-report"),
      report = {
        schemaVersion: 1,
        config: this.config(),
        findings: [],
        errors: [],
        runtime: {},
      };
    try {
      required(this.env, [
        "NIGHTLY_YOUTRACK_PROJECT",
        "NIGHTLY_YOUTRACK_TIME_TRACKING_ARTICLE",
        "NIGHTLY_YOUTRACK_TESTER",
      ]);
      if ((this.env.NIGHTLY_NPM_ENABLED || "true") === "true") {
        try {
          ensure(
            fs.statSync(repositoryPath(root, "package-lock.json")).isFile(),
            "package-lock.json is required",
          );
          const [, values] = await this.auditNpm(
            root,
            path.join(output, "npm.json"),
          );
          report.findings.push(...values);
        } catch (error) {
          report.errors.push("npm: " + error.message);
        }
      }
      try {
        const dockerfile = this.env.NIGHTLY_DOCKERFILE || "build/Dockerfile",
          image = this.immutableImage(
            runtimeFromDockerfile(
              fs.readFileSync(repositoryPath(root, dockerfile), "utf8"),
            ),
          ),
          platforms = (this.env.NIGHTLY_PLATFORMS || "linux/amd64").split(",");
        report.runtime = { image, dockerfile, platforms };
        for (const [index, platform] of platforms.entries()) {
          const [, values, version] = await this.scanImage(
            image,
            platform,
            undefined,
            path.join(output, `runtime-${index}.json`),
          );
          report.runtime[platform] = { node: version };
          report.findings.push(...values);
        }
      } catch (error) {
        report.errors.push("runtime: " + error.message);
      }
    } catch (error) {
      report.errors.push(error.message);
    } finally {
      report.findings = mergeFindings(report.findings);
      save(path.join(output, "findings.json"), report);
      fs.writeFileSync(
        path.join(output, "scan.env"),
        "NIGHTLY_SCAN_JOB_ID=" + this.env.CI_JOB_ID + "\n",
      );
    }
    for (const error of report.errors)
      console.error("ERROR security scan: " + diagnostic(error, this.env));
    return report.errors.length ? 1 : 0;
  }
}
module.exports = { Scanner, runtimeFromDockerfile, NODE_FEED };

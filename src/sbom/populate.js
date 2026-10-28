// Central catalogue writer. Protected pipeline/resource_group remain in CI.
const io = require("../automation");
const { isDryRun } = require("../cli/command-executor");
const { required, checkRegistryAccess } = require("../preflight/automation");
const {
  fs,
  path,
  ensure,
  sha,
  json,
  stable,
  exec,
  safePath,
  SEMVER,
  COMMIT,
  DIGEST,
  temporary,
  save,
} = io;
const schema = require("./schema");
const {
  GENERATION,
  CONFIG_TYPE,
  OCI_TYPE,
  MAX_PAYLOAD,
  encoded,
  purl,
  canonicalRepository,
  validateManifest,
  validateCatalog,
} = schema;
const provenance = require("./provenance");
const { Unresolved } = provenance;
const UPSTREAM = "https://github.com/vercel/next.js.git";
const MAX_FILE = 32 * 1024 * 1024,
  MAX_TARBALL = 200 * 1024 * 1024,
  MAX_HISTORY = 256;
function versions(value) {
  const values = json(value);
  ensure(
    Array.isArray(values) && values.length >= 1 && values.length <= 10,
    "next_versions must contain 1..10 exact versions",
  );
  ensure(
    values.every(
      (v) => typeof v === "string" && v.length <= 100 && SEMVER.test(v),
    ),
    "Only exact npm semver versions are accepted",
  );
  return [...new Set(values)];
}
function publicationRepository(value) {
  ensure(
    typeof value === "string" && value.length <= 255,
    "Invalid central publication namespace",
  );
  canonicalRepository(value);
  const [host, ...parts] = value.split("/"),
    parsed = new URL("https://" + host);
  ensure(
    !host.includes(":") ||
      (Number(host.split(":")[1]) > 0 && Number(host.split(":")[1]) <= 65535),
    "Invalid central registry port",
  );
  ensure(
    parsed.hostname
      .split(".")
      .every((label) =>
        /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?![\s\S])/.test(label),
      ),
    "Invalid central registry host",
  );
  ensure(
    parts.every((part) =>
      /^[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*(?![\s\S])/.test(part),
    ),
    "Invalid central publication namespace segment",
  );
  return value + "/next";
}
function readTarball(data) {
  const result = {};
  for (const entry of io.tarEntries(data)) {
    ensure(safePath(entry.name), "Unsafe archive path");
    if (entry.name === "package" && entry.directory) continue;
    ensure(entry.name.startsWith("package/"), "Unexpected npm archive prefix");
    if (entry.directory) continue;
    const relative = entry.name.slice("package/".length);
    if (relative === "package.json" || relative.startsWith("dist/compiled/")) {
      ensure(!Object.hasOwn(result, relative), "Duplicate archive path");
      result[relative] = Buffer.from(entry.data);
    }
  }
  return result;
}
class Git {
  constructor(directory, remaining = (limit) => limit) {
    this.directory = directory;
    this.remaining = remaining;
    this.env = {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_TERMINAL_PROMPT: "0",
    };
    // Do not allow inherited injected config, helpers or transport overrides.
    for (const key of Object.keys(this.env))
      if (
        /^GIT_CONFIG_(COUNT|KEY_|VALUE_)/.test(key) ||
        ["GIT_SSH_COMMAND", "GIT_PROXY_COMMAND"].includes(key)
      )
        delete this.env[key];
    this.call("init", "--bare", directory);
    this.call("remote", "add", "origin", UPSTREAM);
  }
  call(...args) {
    const result = exec(
      [
        "git",
        "-C",
        this.directory,
        "-c",
        "core.hooksPath=/dev/null",
        "-c",
        "protocol.file.allow=never",
        "-c",
        "protocol.ext.allow=never",
        ...args,
      ],
      {
        env: this.env,
        timeout: this.remaining(300000),
        maxBuffer: MAX_FILE,
        binary: true,
        allowed: [0, 128],
        label: "Upstream Git operation",
      },
    );
    if (result.status) {
      if (
        args[0] === "show" &&
        String(result.stderr).includes("does not exist")
      )
        return null;
      throw new Error("Upstream Git operation failed: " + args[0]);
    }
    return result.stdout;
  }
  fetch(commit) {
    ensure(COMMIT.test(commit), "Invalid Git commit");
    this.call("fetch", "--no-tags", "--filter=blob:none", "origin", commit);
    ensure(
      String(this.call("rev-parse", commit + "^{commit}")).trim() === commit,
      "Git commit mismatch",
    );
  }
  releaseCommit(version, npmCommit) {
    if (npmCommit) return npmCommit;
    const tag = "refs/tags/v" + version,
      refs = {};
    for (const row of String(
      this.call("ls-remote", "--tags", UPSTREAM, tag, tag + "^{}"),
    )
      .trim()
      .split("\n")) {
      const [commit, ref] = row.split("\t");
      refs[ref] = commit;
    }
    const commit = refs[tag + "^{}"] || refs[tag];
    ensure(
      COMMIT.test(commit),
      "No exact official release tag for npm publication",
    );
    return commit;
  }
  show(commit, file) {
    ensure(safePath(file), "Unsafe Git path");
    return this.call("show", commit + ":" + file);
  }
  tree(commit, location) {
    ensure(safePath(location), "Unsafe Git tree path");
    const result = {};
    for (const row of String(
      this.call("ls-tree", "-r", "-z", commit, "--", location),
    )
      .split("\0")
      .filter(Boolean)) {
      const tab = row.indexOf("\t"),
        [mode, kind, oid] = row.slice(0, tab).split(" "),
        filename = row.slice(tab + 1);
      if (kind !== "blob" || !["100644", "100755"].includes(mode))
        throw new Unresolved("non-regular file in upstream compiled tree");
      const relative = filename.slice(location.length + 1);
      ensure(safePath(relative), "Unsafe Git filename");
      if (Object.keys(result).length > 2048)
        throw new Unresolved("compiled tree file limit exceeded");
      result[relative] = this.call("cat-file", "blob", oid);
    }
    return result;
  }
  *history(commit, filename) {
    const blocks = String(
      this.call(
        "log",
        "--follow",
        "--find-renames=100%",
        "--format=COMMIT:%H",
        "--name-status",
        "--max-count=" + (MAX_HISTORY + 1),
        commit,
        "--",
        filename,
      ),
    )
      .split("COMMIT:")
      .slice(1);
    if (blocks.length > MAX_HISTORY)
      throw new Unresolved("compiled history limit exceeded");
    for (const block of blocks) {
      const [revision, ...rows] = block.trim().split("\n");
      for (const row of rows) {
        const fields = row.split("\t");
        if (fields.length >= 2 && !fields[0].startsWith("R"))
          yield [revision, fields.at(-1)];
      }
    }
  }
}
class Publisher {
  constructor(env = process.env, deps = {}) {
    this.env = env;
    this.deps = deps;
    this.repository = env.SBOM_CATALOG_PUBLISH_REPOSITORY
      ? env.SBOM_CATALOG_PUBLISH_REPOSITORY + "/next"
      : null;
    this.registryConfig = null;
    this.deadline = Date.now() + 1500000;
  }
  remaining = (limit = 120000) => {
    const left = this.deadline - Date.now();
    ensure(left >= 1000, "Resolver time budget exhausted");
    return Math.min(limit, left);
  };
  async download(url, limit) {
    const parsed = new URL(url);
    const authority = url.match(/^https:\/\/([^/?#]+)/i)?.[1];
    ensure(
      authority?.toLowerCase() === "registry.npmjs.org" &&
        parsed.protocol === "https:" &&
        parsed.hostname === "registry.npmjs.org" &&
        !parsed.port &&
        !parsed.username &&
        !parsed.password &&
        !/^https:\/\/registry\.npmjs\.org:\d/.test(url),
      "Only the official npm registry is accepted",
    );
    const res = await (this.deps.request || io.request)(url, {
      limit,
      timeout: this.remaining(60000),
    });
    ensure(res.status === 200, "Unexpected npm status or redirect");
    return res.body;
  }
  async officialPackage(version) {
    const metadata = json(
      await this.download(
        "https://registry.npmjs.org/next/" + encoded(version),
        MAX_PAYLOAD,
      ),
    );
    ensure(
      metadata.name === "next" && metadata.version === version,
      "npm metadata identity mismatch",
    );
    const commit = metadata.gitHead;
    ensure(
      commit == null || (typeof commit === "string" && COMMIT.test(commit)),
      "Invalid official npm gitHead",
    );
    const dist = metadata.dist || {},
      integrity = dist.integrity || "";
    ensure(
      /^sha512-[A-Za-z0-9+/]+={0,2}(?![\s\S])/.test(integrity),
      "Official sha512 integrity required",
    );
    const archive = await this.download(dist.tarball, MAX_TARBALL);
    ensure(
      Buffer.from(sha(archive, "sha512"), "hex").toString("base64") ===
        integrity.slice(7),
      "npm tarball integrity mismatch",
    );
    const files = readTarball(archive),
      manifest = json(files["package.json"]);
    ensure(
      manifest.name === "next" && manifest.version === version,
      "npm tarball manifest mismatch",
    );
    return [files, commit, integrity];
  }
  async verifyRegistry(name, version, proof) {
    const metadata = json(
      await this.download(
        "https://registry.npmjs.org/" + encoded(name) + "/" + encoded(version),
        MAX_PAYLOAD,
      ),
    );
    ensure(
      metadata.name === name && metadata.version === version,
      "Resolved npm metadata identity mismatch",
    );
    const valid = new Set(
      [metadata.dist?.integrity].filter(
        (value) => typeof value === "string" && value.startsWith("sha512-"),
      ),
    );
    if (/^[a-f0-9]{40}(?![\s\S])/.test(metadata.dist?.shasum || ""))
      valid.add(
        "sha1-" + Buffer.from(metadata.dist.shasum, "hex").toString("base64"),
      );
    if (!valid.has(proof.integrity))
      throw new Unresolved(
        "historical lock resolution differs from official npm integrity",
      );
  }
  async buildCatalog(version, git) {
    console.log(
      "Next catalog " + version + ": downloading official publication",
    );
    const [files, npmCommit, integrity] = await this.officialPackage(version),
      commit = git.releaseCommit(version, npmCommit);
    git.fetch(commit);
    const catalog = {
      schemaVersion: 1,
      kind: "vendored-package-catalog",
      generation: GENERATION,
      owner: {
        name: "next",
        version,
        purl: purl("next", version),
        manifestSha256: sha(files["package.json"]),
        integrity,
        sourceCommit: commit,
      },
      components: [],
      unresolved: [],
    };
    for (const [location, manifest, contents] of provenance.compiledComponents(
      files,
    )) {
      console.log("Next catalog " + version + ": resolving " + location);
      try {
        catalog.components.push(
          await provenance.resolveComponent(
            git,
            commit,
            location,
            manifest,
            contents,
            (...args) => this.verifyRegistry(...args),
          ),
        );
      } catch (error) {
        if (!(error instanceof Unresolved)) throw error;
        catalog.unresolved.push({
          path: location,
          name: manifest.name || "",
          reason: error.message,
        });
      }
    }
    ensure(
      catalog.components.length || catalog.unresolved.length,
      "No compiled packages found; upstream layout may have changed",
    );
    return catalog;
  }
  oras(args, { input, cwd, binary = true } = {}) {
    const config = this.registryConfig
      ? ["--registry-config", this.registryConfig]
      : [];
    return (this.deps.exec || exec)(["oras", ...args, ...config], {
      input,
      cwd,
      binary,
      env: this.env,
      timeout: this.remaining(),
      maxBuffer: MAX_PAYLOAD + 1024,
      label: "OCI operation",
    }).stdout;
  }
  descriptor(ref) {
    const config = this.registryConfig
      ? ["--registry-config", this.registryConfig]
      : [];
    const result = (this.deps.exec || exec)(
      ["oras", "manifest", "fetch", "--descriptor", ref, ...config],
      {
        env: this.env,
        binary: false,
        allowed: [0, 1, 2],
        timeout: this.remaining(60000),
        maxBuffer: MAX_PAYLOAD + 1024,
        label: "Catalog lookup",
      },
    );
    if (result.status) {
      ensure(
        /manifest_unknown|manifest unknown|not found/i.test(result.stderr),
        "Catalog lookup failed (not a cache miss)",
      );
      return null;
    }
    const value = json(result.stdout);
    ensure(
      DIGEST.test(value.digest) && value.mediaType === OCI_TYPE,
      "Invalid OCI digest",
    );
    return value.digest;
  }
  tagFor(version) {
    return this.repository + ":" + GENERATION + "-" + sha(version);
  }
  readback(digest, version, expectedPayload) {
    ensure(DIGEST.test(digest), "Invalid readback digest");
    const manifestBytes = Buffer.from(
      this.oras(["manifest", "fetch", this.repository + "@" + digest]),
    );
    ensure(
      "sha256:" + sha(manifestBytes) === digest,
      "Catalog manifest readback integrity failed",
    );
    const layer = validateManifest(json(manifestBytes)),
      payload = Buffer.from(
        this.oras([
          "blob",
          "fetch",
          "--output",
          "-",
          this.repository + "@" + layer.digest,
        ]),
      );
    ensure(
      payload.length === layer.size &&
        "sha256:" + sha(payload) === layer.digest,
      "Catalog payload readback integrity failed",
    );
    ensure(
      !expectedPayload || payload.equals(expectedPayload),
      "Published payload differs from generated catalog",
    );
    return validateCatalog(json(payload), version);
  }
  publish(version, catalog, workdir) {
    const ref = this.tagFor(version),
      existing = this.descriptor(ref);
    if (existing) {
      this.readback(existing, version);
      return this.repository + "@" + existing;
    }
    const payload = Buffer.from(stable(catalog));
    ensure(payload.length <= MAX_PAYLOAD, "Catalog payload too large");
    fs.writeFileSync(path.join(workdir, "catalog.json"), payload);
    fs.writeFileSync(path.join(workdir, "config.json"), "{}");
    this.oras(
      [
        "push",
        "--image-spec",
        "v1.0",
        "--config",
        "config.json:" + CONFIG_TYPE,
        ref,
        "catalog.json:application/json",
      ],
      { cwd: workdir },
    );
    const digest = this.descriptor(ref);
    ensure(digest, "Published catalog cannot be read back");
    this.readback(digest, version, payload);
    return this.repository + "@" + digest;
  }
  async main({ cwd = process.cwd(), dry = isDryRun() } = {}) {
    const report = {
        schemaVersion: 1,
        generation: GENERATION,
        results: [],
        status: "error",
      },
      output = path.join(cwd, "sbom-catalog-updater");
    let code = 2;
    try {
      const requested = versions(this.env.NEXT_CATALOG_VERSIONS || "[]");
      ensure(
        this.env.CI_COMMIT_BRANCH === "main" &&
          this.env.CI_COMMIT_REF_PROTECTED === "true",
        "Updater requires protected main",
      );
      required(this.env, [
        "SBOM_CATALOG_PUBLISH_REPOSITORY",
        "NEXUS_USER",
        "NEXUS_PASSWORD",
      ]);
      this.repository = publicationRepository(
        this.env.SBOM_CATALOG_PUBLISH_REPOSITORY,
      );
      report.repository = this.repository;
      ensure(
        this.env.NEXUS_USER && this.env.NEXUS_PASSWORD,
        "Central push credentials NEXUS_USER/NEXUS_PASSWORD are not configured",
      );
      await temporary("next-catalog-", async (dir) => {
        this.registryConfig = path.join(dir, "registry.json");
        await (this.deps.bootstrap || require("./tools").bootstrap)(dir, [
          "oras",
        ]);
        this.env = {
          ...this.env,
          PATH: dir + path.delimiter + (this.env.PATH || ""),
        };
        this.oras(
          [
            "login",
            this.repository.split("/")[0],
            "--username",
            this.env.NEXUS_USER,
            "--password-stdin",
          ],
          { input: this.env.NEXUS_PASSWORD },
        );
        report.preflight = await (
          this.deps.checkRegistryAccess || checkRegistryAccess
        )(this.repository, {
          probe: () => this.descriptor(this.tagFor(requested[0])),
          transport: this.deps.request,
        });
        if (dry) return;
        const gitDir = path.join(dir, "upstream.git");
        fs.mkdirSync(gitDir);
        const git = this.deps.git || new Git(gitDir, this.remaining);
        for (const version of requested) {
          try {
            const digest = this.descriptor(this.tagFor(version));
            let catalog, ref, cached;
            if (digest) {
              catalog = this.readback(digest, version);
              ref = this.repository + "@" + digest;
              cached = true;
            } else {
              catalog = await this.buildCatalog(version, git);
              ref = this.publish(version, catalog, dir);
            }
            report.results.push({
              version,
              status: catalog.unresolved.length ? "partial" : "complete",
              ...(cached ? { cached } : {}),
              ref,
              resolved: catalog.components.length,
              unresolved: catalog.unresolved,
            });
          } catch (error) {
            report.results.push({
              version,
              status: "error",
              reason: error.message,
            });
          }
        }
      });
      code = report.results.some((r) => ["partial", "error"].includes(r.status))
        ? 2
        : 0;
      report.status = code ? "partial" : "complete";
    } catch (error) {
      report.error = error.message;
      if (dry) console.error("SBOM catalog preflight: " + error.message);
    } finally {
      this.registryConfig = null;
      if (!dry) {
        save(path.join(output, "report.json"), report);
        fs.writeFileSync(
          path.join(output, "report.md"),
          "# Next OCI catalog updater\n\nStatus: " +
            report.status +
            "\n\n```json\n" +
            JSON.stringify(report, null, 2) +
            "\n```\n",
        );
        console.log("Catalog updater: " + report.status);
      }
    }
    return code;
  }
}
async function populate(options = {}) {
  return new Publisher(
    { ...process.env, ...(options.env || {}) },
    options.deps,
  ).main(options);
}
module.exports = {
  versions,
  publicationRepository,
  readTarball,
  Git,
  Publisher,
  populate,
  UPSTREAM,
};

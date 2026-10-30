const { cliIdentity } = require("../automation/tooling");
const io = require("../automation");
const { isDryRun, reportPreflight } = require("../cli/command-executor");
const {
  required,
  credentialPair,
  PreflightError,
} = require("../preflight/automation");
const {
  fs,
  path,
  ensure,
  sha,
  json,
  save,
  temporary,
  DIGEST,
  SEMVER,
  safePath,
  exec,
} = io;
const {
  GENERATION,
  OCI_TYPE,
  MAX_PAYLOAD,
  canonicalRepository,
  validateCatalog,
  validateManifest,
  encoded,
} = require("./schema");
const tools = require("./tools");
class MissingCatalog extends Error {}
function authenticated(command, env) {
  return command[0] === "oras" && env.DOCKER_CONFIG
    ? [
        ...command,
        "--registry-config",
        path.join(env.DOCKER_CONFIG, "config.json"),
      ]
    : command;
}
function run(
  command,
  env,
  { missing = false, timeout = 300000, binary = false } = {},
) {
  const result = exec(authenticated(command, env), {
    env,
    allowed: [0, 1, 2],
    timeout,
    binary,
    maxBuffer: 32 * 1024 * 1024,
    label: "Registry/scanner command",
  });
  if (result.status) {
    const message = String(result.stderr).toLowerCase();
    if (
      missing &&
      [
        "manifest_unknown",
        "manifest unknown",
        "not found: not found",
        "response status code 404",
      ].some((marker) => message.includes(marker))
    )
      throw new MissingCatalog("Catalog not published");
    throw new Error("Registry/scanner command failed");
  }
  return result.stdout;
}
function sourceDigests(sbom) {
  const source = sbom.source || {},
    target = source.metadata || {};
  if (source.type !== "image" || !Array.isArray(target.repoDigests || []))
    return new Set();
  return new Set(
    [target.manifestDigest || "", ...(target.repoDigests || [])]
      .filter((v) => typeof v === "string")
      .map((v) => v.split("@").at(-1))
      .filter((v) => DIGEST.test(v)),
  );
}
function discover(sbom) {
  const found = new Map();
  for (const pkg of sbom.artifacts || []) {
    if (pkg.name !== "next" || pkg.type !== "npm") continue;
    ensure(
      typeof pkg.version === "string" && SEMVER.test(pkg.version),
      "Next has no exact valid version",
    );
    for (const location of pkg.locations || []) {
      const name = location.path;
      if (safePath(name, true) && name.endsWith("/next/package.json")) {
        const root = name.slice(0, -"/package.json".length);
        found.set(pkg.version + "\0" + root, {
          name: "next",
          version: pkg.version,
          root,
        });
      }
    }
  }
  return [...found.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, v]) => v);
}
function catalogRef(repository, version, env, command = run) {
  const shard = repository + "/next";
  const tag = GENERATION + "-" + sha(version);
  const descriptor = json(
    command(
      ["oras", "manifest", "fetch", "--descriptor", shard + ":" + tag],
      env,
      { missing: true },
    ),
  );
  ensure(
    DIGEST.test(descriptor.digest) && descriptor.mediaType === OCI_TYPE,
    "Invalid catalog manifest descriptor",
  );
  const reference = shard + "@" + descriptor.digest;
  const bytes = Buffer.from(
    command(["oras", "manifest", "fetch", reference], env, {
      binary: true,
      timeout: 60000,
    }),
  );
  ensure(
    bytes.length <= MAX_PAYLOAD && "sha256:" + sha(bytes) === descriptor.digest,
    "Catalog manifest integrity failed",
  );
  const layer = validateManifest(json(bytes));
  // stdout avoids any archive extraction or registry-controlled filename.
  const body = Buffer.from(
    command(
      ["oras", "blob", "fetch", "--output", "-", shard + "@" + layer.digest],
      env,
      { binary: true, timeout: 60000 },
    ),
  );
  ensure(
    body.length === layer.size && "sha256:" + sha(body) === layer.digest,
    "Catalog payload integrity failed",
  );
  validateCatalog(json(body), version);
  return reference;
}
async function trigger(versions, env, transport = io.request) {
  ensure(
    versions.length <= 10 &&
      versions.every(
        (version) => typeof version === "string" && SEMVER.test(version),
      ),
    "At most 10 exact Next versions per request",
  );
  const api = (env.CI_API_V4_URL || "").replace(/\/(?![\s\S])/, ""),
    server = (env.CI_SERVER_URL || "").replace(/\/(?![\s\S])/, "");
  const parsed = new URL(server);
  ensure(
    env.CI_JOB_TOKEN &&
      api === server + "/api/v4" &&
      parsed.protocol === "https:" &&
      !parsed.username &&
      !parsed.password &&
      parsed.pathname === "/",
    "Missing trusted GitLab API configuration",
  );
  required(env, ["SBOM_CATALOG_UPDATER_PROJECT"]);
  const body = JSON.stringify({
    token: env.CI_JOB_TOKEN,
    ref: env.SBOM_CATALOG_UPDATER_REF || "main",
    inputs: {
      operation: "populate-next-catalog",
      next_versions: JSON.stringify(versions),
      ...(cliIdentity(env) ? { cli_identity: JSON.stringify(cliIdentity(env)) } : {}),
    },
  });
  // One POST. A transport timeout must not create another downstream pipeline.
  const res = await transport(
    api +
      "/projects/" +
      encoded(env.SBOM_CATALOG_UPDATER_PROJECT) +
      "/trigger/pipeline",
    {
      method: "POST",
      body,
      headers: { "Content-Type": "application/json" },
      timeout: 30000,
      limit: 1024 * 1024,
    },
  );
  ensure(res.status >= 200 && res.status < 300, "Catalog request failed");
  const url = json(res.body).web_url;
  ensure(
    typeof url === "string" && url.startsWith(server + "/"),
    "Invalid downstream pipeline URL",
  );
  return url;
}
async function execute(env, directory, deps = {}, { dry = false } = {}) {
  const selection = {
      schemaVersion: 1,
      status: "error",
      image: {},
      catalogs: [],
      missing: [],
      request: { status: "not_needed" },
    },
    errors = [];
  const command = deps.run || run;
  try {
    if (
      env.SBOM_CATALOG_CLIENT_ENABLED !== "true" ||
      env.SBOM_CATALOG_FRAMEWORK !== "nextjs"
    ) {
      selection.status = "skipped";
      return { selection, errors };
    }
    required(env, ["SBOM_CATALOG_REPOSITORY", "DOCKER_IMAGE", "APP_VERSION"]);
    const repository = canonicalRepository(env.SBOM_CATALOG_REPOSITORY);
    credentialPair(env, "SBOM_CATALOG_USER", "SBOM_CATALOG_PASSWORD");
    await (deps.bootstrap || tools.bootstrap)(directory);
    const runtime = {
      ...env,
      PATH: directory + path.delimiter + (env.PATH || ""),
      SYFT_CHECK_FOR_APP_UPDATE: "false",
    };
    const auths = {};
    for (const [registry, user, password] of [
      [env.CI_REGISTRY, "gitlab-ci-token", env.CI_JOB_TOKEN],
      [
        repository.split("/")[0],
        env.SBOM_CATALOG_USER,
        env.SBOM_CATALOG_PASSWORD,
      ],
    ]) {
      if (registry && user && password)
        auths[registry] = {
          auth: Buffer.from(user + ":" + password).toString("base64"),
        };
    }
    fs.writeFileSync(
      path.join(directory, "config.json"),
      JSON.stringify({ auths }),
      { mode: 0o600 },
    );
    runtime.DOCKER_CONFIG = directory;
    const image = canonicalRepository(env.DOCKER_IMAGE || "");
    ensure(
      /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}(?![\s\S])/.test(
        env.APP_VERSION || "",
      ),
      "Missing valid application image tag",
    );
    const descriptor = json(
      command(
        [
          "oras",
          "manifest",
          "fetch",
          "--descriptor",
          image + ":" + env.APP_VERSION,
        ],
        runtime,
      ),
    );
    ensure(DIGEST.test(descriptor.digest), "Invalid application image digest");
    if (dry) {
      required(env, [
        "SBOM_CATALOG_UPDATER_PROJECT",
        "CI_JOB_TOKEN",
        "CI_API_V4_URL",
        "CI_SERVER_URL",
      ]);
      const server = new URL(env.CI_SERVER_URL);
      ensure(
        server.protocol === "https:" &&
          !server.username &&
          !server.password &&
          server.pathname === "/" &&
          env.CI_API_V4_URL.replace(/\/$/, "") ===
            env.CI_SERVER_URL.replace(/\/$/, "") + "/api/v4",
        "Missing trusted GitLab API configuration",
      );
      reportPreflight(
        "sbom catalog resolve",
        "image-registry-access",
        "проверены настройки каталога и чтение immutable образа",
      );
      selection.status = "ready";
      return { selection, errors };
    }
    const reference = image + "@" + descriptor.digest;
    selection.image = { reference, digest: descriptor.digest };
    const sbom = json(
      command(
        [
          "syft",
          "scan",
          "registry:" + reference,
          "--platform",
          "linux/amd64",
          "-o",
          "syft-json",
        ],
        runtime,
      ),
    );
    ensure(
      sourceDigests(sbom).has(descriptor.digest),
      "Scanner source digest mismatch",
    );
    const owners = discover(sbom);
    ensure(owners.length, "No installed Next package manifest found");
    const resolved = new Map(),
      missing = new Set();
    for (const owner of owners) {
      if (!resolved.has(owner.version)) {
        try {
          resolved.set(owner.version, {
            ref: (deps.catalogRef || catalogRef)(
              repository,
              owner.version,
              runtime,
              command,
            ),
          });
        } catch (error) {
          if (error instanceof MissingCatalog) {
            resolved.set(owner.version, { reason: "catalog not published" });
            missing.add(owner.version);
          } else {
            resolved.set(owner.version, {
              reason: "catalog lookup failed: " + error.name,
            });
            errors.push(resolved.get(owner.version).reason);
          }
        }
      }
      const result = resolved.get(owner.version);
      if (result.ref) selection.catalogs.push({ ref: result.ref, owner });
      else selection.missing.push({ ...owner, reason: result.reason });
    }
    if (missing.size) {
      try {
        selection.request = {
          status: "submitted",
          pipelineUrl: await (deps.trigger || trigger)(
            [...missing].sort(),
            env,
          ),
        };
      } catch (error) {
        selection.request = { status: "failed" };
        errors.push(
          "catalog request failed: " +
            (error instanceof PreflightError ? error.message : error.name),
        );
      }
    }
    selection.status =
      selection.missing.length || errors.length ? "partial" : "complete";
  } catch (error) {
    errors.push(
      "catalog discovery failed: " +
        (error instanceof PreflightError ? error.message : error.name),
    );
  }
  return { selection, errors };
}
async function resolve(options = {}) {
  const dry = options.dry ?? isDryRun();
  const env = { ...process.env, ...(options.env || {}) },
    prefix = env.SBOM_CATALOG_PREFIX ?? "site:";
  ensure(
    /^[A-Za-z0-9_.:-]*(?![\s\S])/.test(prefix) && ![".", ".."].includes(prefix),
    "Invalid catalog artifact prefix",
  );
  const output = path.join(
    options.cwd || process.cwd(),
    "sbom-catalog",
    prefix,
  );
  const { selection, errors } = await temporary("sbom-resolve-", (dir) =>
    execute(env, dir, options.deps, { dry }),
  );
  if (dry) {
    if (errors.length)
      console.error("SBOM catalog preflight: " + errors.join("; "));
    return ["ready", "skipped"].includes(selection.status) ? 0 : 2;
  }
  save(path.join(output, "selection.json"), selection);
  save(path.join(output, "report.json"), { ...selection, errors });
  const lines = [
    "# SBOM catalog discovery",
    "",
    "Status: " + selection.status,
    "",
    "Available: " + selection.catalogs.length,
    "Missing: " + selection.missing.length,
    "Request: " + selection.request.status,
  ];
  if (selection.request.pipelineUrl)
    lines.push("", selection.request.pipelineUrl);
  lines.push(...errors.map((error) => "\n- " + error));
  fs.writeFileSync(path.join(output, "report.md"), lines.join("\n") + "\n");
  console.log("SBOM catalog discovery: " + selection.status);
  return ["complete", "skipped"].includes(selection.status) ? 0 : 2;
}
module.exports = {
  MissingCatalog,
  authenticated,
  run,
  sourceDigests,
  discover,
  catalogRef,
  trigger,
  execute,
  resolve,
};

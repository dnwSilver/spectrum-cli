const io = require("../automation");
const { fs, path, ensure, json, exec, request, sleep, temporary } = io;
const { encoded } = require("../sbom/schema");
function cleanEnv(env = process.env) {
  return Object.fromEntries(
    Object.entries(env).filter(
      ([key]) =>
        !/TOKEN|PASSWORD|SECRET|MATTERMOST|AUTHFILE/i.test(key) &&
        !/^(GIT_CONFIG_|CI_|GLAB_|GITLAB_|YOUTRACK_|MATTERMOST_|NEXUS_)/.test(
          key,
        ) &&
        (!key.startsWith("TRIVY_") ||
          [
            "TRIVY_DB_REPOSITORY",
            "TRIVY_JAVA_DB_REPOSITORY",
            "TRIVY_CACHE_DIR",
          ].includes(key)),
    ),
  );
}
function run(args, cwd, options = {}, env = process.env) {
  const clean = cleanEnv(env);
  if (args[0] === "npm")
    for (const key of ["NPM_TOKEN", "NODE_AUTH_TOKEN"])
      if (env[key]) clean[key] = env[key];
  try {
    return exec(args, { cwd, ...options, env: clean });
  } catch (error) {
    const detail = diagnostic(error.stderr || "", env);
    if (detail) error.message += ": " + detail;
    throw error;
  }
}
function diagnostic(value, env = process.env) {
  let text = String(value || "");
  const secrets = Object.entries(env)
    .filter(
      ([key, value]) =>
        /TOKEN|PASSWORD|SECRET|MATTERMOST_HOOK/i.test(key) && value,
    )
    .map(([, value]) => String(value));
  if (env.NEXUS_USER && env.NEXUS_PASSWORD)
    secrets.push(
      Buffer.from(env.NEXUS_USER + ":" + env.NEXUS_PASSWORD).toString("base64"),
    );
  for (const secret of secrets.sort((a, b) => b.length - a.length))
    text = text.split(secret).join("[REDACTED]");
  return text
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/g, "$1[REDACTED]@")
    .replace(
      /([?&](?:token|access_token|auth|password)=)[^&\s]+/gi,
      "$1[REDACTED]",
    )
    .replace(
      /\b(Bearer|Basic)\s+(?!realm=)[A-Za-z0-9+/_=.-]+/gi,
      "$1 [REDACTED]",
    )
    .replace(/[\r\n]+/g, " ")
    .slice(0, 2000)
    .trim();
}
function logPhaseErrors(phase, report, env = process.env) {
  for (const message of new Set(report.errors || []))
    console.error("ERROR " + phase + ": " + diagnostic(message, env));
}
async function registryAuth(env, action) {
  return temporary("nightly-registry-", async (directory) => {
    const auths = {};
    ensure(
      Boolean(env.NEXUS_USER) === Boolean(env.NEXUS_PASSWORD),
      "Configure both NEXUS_USER and NEXUS_PASSWORD",
    );
    if (env.NEXUS_USER && env.NEXUS_PASSWORD) {
      ensure(
        env.NIGHTLY_REGISTRY_HOSTS?.trim(),
        "NIGHTLY_REGISTRY_HOSTS is required with registry credentials",
      );
      for (const host of env.NIGHTLY_REGISTRY_HOSTS.split(",")) {
        ensure(
          /^[a-zA-Z0-9.-]+(?::\d+)?(?![\s\S])/.test(host),
          "Invalid registry hostname",
        );
        auths[host] = {
          auth: Buffer.from(env.NEXUS_USER + ":" + env.NEXUS_PASSWORD).toString(
            "base64",
          ),
        };
      }
    }
    if (env.CI_REGISTRY_USER && env.CI_REGISTRY_PASSWORD)
      auths[env.CI_REGISTRY] = {
        auth: Buffer.from(
          env.CI_REGISTRY_USER + ":" + env.CI_REGISTRY_PASSWORD,
        ).toString("base64"),
      };
    const runtime = { ...env };
    if (Object.keys(auths).length) {
      const file = path.join(directory, "config.json");
      fs.writeFileSync(file, JSON.stringify({ auths }), { mode: 0o600 });
      runtime.DOCKER_CONFIG = directory;
      runtime.REGISTRY_AUTH_FILE = file;
    }
    return action(runtime);
  });
}
async function artifactRedirect(url, transport = request) {
  for (let hop = 0; hop < 4; hop++) {
    const parsed = new URL(url);
    ensure(
      parsed.protocol === "https:" && !parsed.username && !parsed.password,
      "Unsafe artifact redirect",
    );
    let res;
    try {
      res = await transport(url, {
        headers: { "User-Agent": "nightly-security" },
      });
    } catch {
      throw new Error("Artifact download connection failed");
    }
    if (
      [301, 302, 303, 307, 308].includes(res.status) &&
      res.headers.get("location")
    ) {
      url = new URL(res.headers.get("location"), url).href;
      continue;
    }
    ensure(
      res.status >= 200 && res.status < 300,
      `Artifact download failed (HTTP ${res.status})`,
    );
    return res.body;
  }
  throw new Error("Too many artifact redirects");
}
class API {
  constructor(base, headers = {}, transport = request, pause = sleep) {
    const parsed = new URL(base);
    ensure(
      parsed.protocol === "https:" && !parsed.username && !parsed.password,
      "HTTPS is required for API endpoints",
    );
    this.base = base.replace(/\/(?![\s\S])/, "");
    this.headers = headers;
    this.transport = transport;
    this.pause = pause;
  }
  async request(method, location, data, { raw = false, query } = {}) {
    let url = this.base + "/" + location.replace(/^\//, "");
    if (query) url += "?" + new URLSearchParams(query);
    const headers = {
      Accept: "application/json",
      "User-Agent": "nightly-security",
      ...this.headers,
    };
    if (data !== undefined) headers["Content-Type"] = "application/json";
    for (let attempt = 0; attempt < 3; attempt++) {
      let res;
      try {
        res = await this.transport(url, {
          method,
          headers,
          body: data === undefined ? undefined : JSON.stringify(data),
        });
      } catch {
        throw new Error(`API ${method} connection failed`);
      }
      if (
        method === "GET" &&
        raw &&
        [301, 302, 303, 307, 308].includes(res.status) &&
        res.headers.get("location")
      )
        return artifactRedirect(
          new URL(res.headers.get("location"), url).href,
          this.transport,
        );
      if (
        method === "GET" &&
        [429, 502, 503, 504].includes(res.status) &&
        attempt < 2
      ) {
        await this.pause(1000 * 2 ** attempt);
        continue;
      }
      if (res.status < 200 || res.status >= 300) {
        const error = new Error(`API ${method} failed (HTTP ${res.status})`);
        error.status = res.status;
        throw error;
      }
      return raw ? res.body : json(res.body.length ? res.body : "null");
    }
    throw new Error("API retries exhausted");
  }
  get(location, options) {
    return this.request("GET", location, undefined, options);
  }
  post(location, data) {
    return this.request("POST", location, data);
  }
}
function glab(env = process.env) {
  ensure(
    env.CI_API_V4_URL && env.GLAB_BOT_PAT,
    "GitLab API and GLAB_BOT_PAT are required",
  );
  return new API(env.CI_API_V4_URL, { "PRIVATE-TOKEN": env.GLAB_BOT_PAT });
}
const projectPath = (project) => "projects/" + encoded(String(project));
async function pages(api, location, query = {}) {
  const result = [];
  for (let page = 1; ; page++) {
    const batch = await api.get(location, {
      query: { ...query, per_page: 100, page },
    });
    ensure(Array.isArray(batch), "Expected paginated API list");
    result.push(...batch);
    if (batch.length < 100) return result;
  }
}
module.exports = {
  cleanEnv,
  diagnostic,
  logPhaseErrors,
  run,
  registryAuth,
  artifactRedirect,
  API,
  glab,
  projectPath,
  pages,
};

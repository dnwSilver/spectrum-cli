// Noninteractive preflights. Remote checks are read-only and never log credentials.
const { fs, path, ensure, request } = require("../automation");
const { API, projectPath } = require("../security/runtime");
const { encoded } = require("../sbom/schema");
const { reportPreflight } = require("../cli/command-executor");
class PreflightError extends Error {
  constructor(message) {
    super(message);
    this.name = "PreflightError";
  }
}
function check(condition, message) {
  if (!condition) throw new PreflightError(message);
}
function required(env, names) {
  const missing = names.filter(
    (name) => typeof env[name] !== "string" || !env[name].trim(),
  );
  check(!missing.length, "Missing required variables: " + missing.join(", "));
  return env;
}
function credentialPair(env, user, password) {
  check(
    Boolean(env[user]) === Boolean(env[password]),
    `Configure both ${user} and ${password}`,
  );
}
function httpsEndpoint(value, name) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new PreflightError(name + " must be an explicit HTTPS URL");
  }
  check(
    typeof value === "string" &&
      !/[\x00-\x20]/.test(value) &&
      parsed.protocol === "https:" &&
      !parsed.username &&
      !parsed.password &&
      !parsed.search &&
      !parsed.hash,
    name + " must be an HTTPS URL without credentials, query or fragment",
  );
  return value.replace(/\/+$/, "");
}
async function get(api, location, options, label) {
  try {
    return await api.get(location, options);
  } catch (error) {
    const status = Number.isInteger(error.status)
      ? ` (HTTP ${error.status})`
      : "";
    throw new PreflightError(
      `${label}: connection, authentication or access check failed${status}`,
    );
  }
}
async function checkGitlabAccess(
  env,
  projects,
  { write = false, purpose = "repository", api } = {},
) {
  required(env, ["CI_API_V4_URL", "GLAB_BOT_PAT"]);
  const base = httpsEndpoint(env.CI_API_V4_URL, "CI_API_V4_URL");
  if (env.CI_SERVER_URL)
    check(
      base === httpsEndpoint(env.CI_SERVER_URL, "CI_SERVER_URL") + "/api/v4",
      "GitLab API URL does not match CI_SERVER_URL",
    );
  check(base.endsWith("/api/v4"), "CI_API_V4_URL must end with /api/v4");
  const client = api || new API(base, { "PRIVATE-TOKEN": env.GLAB_BOT_PAT });
  const user = await get(client, "user", undefined, "GitLab identity");
  check(
    user?.id && user.state === "active",
    "GitLab token does not belong to an active user",
  );
  const token = await get(
    client,
    "personal_access_tokens/self",
    undefined,
    "GitLab token scope",
  );
  check(
    token?.active === true &&
      token.revoked !== true &&
      Array.isArray(token.scopes),
    "GitLab token is inactive, revoked or cannot be inspected",
  );
  check(
    token.scopes.includes("api") ||
      (!write && token.scopes.includes("read_api")),
    write
      ? "GitLab token requires the api scope for pipeline/repository writes"
      : "GitLab token requires read_api or api scope",
  );
  for (const project of [...new Set(projects)]) {
    check(
      typeof project === "string" && project.trim() && !/[\r\n]/.test(project),
      "GitLab project must be configured explicitly",
    );
    const data = await get(
      client,
      projectPath(project),
      undefined,
      "GitLab project access",
    );
    const level = user.is_admin
      ? 50
      : Math.max(
          data.permissions?.project_access?.access_level || 0,
          data.permissions?.group_access?.access_level || 0,
        );
    check(
      level >= (write ? 30 : 20),
      write
        ? "GitLab project requires Developer access or higher"
        : "GitLab project requires Reporter access or higher",
    );
    if (write) {
      check(data.archived !== true, "GitLab project is archived");
      if (purpose === "pipeline")
        check(
          data.builds_access_level !== "disabled",
          "GitLab pipeline access is disabled",
        );
      else
        check(
          data.repository_access_level !== "disabled" &&
            data.merge_requests_access_level !== "disabled" &&
            data.can_create_merge_request_in !== false,
          "GitLab repository/MR access is disabled",
        );
    }
  }
  reportPreflight(
    "automation",
    "gitlab-access",
    "проверены GitLab token, scope и роль в проектах",
  );
  return {
    identity: "verified",
    token_scope: "verified",
    project_role: "verified",
    protected_branch_policies: "checked_by_operations",
  };
}
async function checkYouTrackAccess(env, cfg, api) {
  required(env, ["YOUTRACK_URL", "YOUTRACK_PRIVATE_TOKEN"]);
  const base = httpsEndpoint(env.YOUTRACK_URL, "YOUTRACK_URL");
  check(
    /^[A-Za-z0-9_-]+$/.test(cfg.youtrack_project || ""),
    "YouTrack project key is required",
  );
  const client =
    api ||
    new API(base + "/api", {
      Authorization: "Bearer " + env.YOUTRACK_PRIVATE_TOKEN,
    });
  const user = await get(
    client,
    "users/me",
    { query: { fields: "id,login,guest,banned" } },
    "YouTrack identity",
  );
  check(
    user?.id && user.login && user.guest !== true && user.banned !== true,
    "YouTrack token must belong to an active, non-guest user",
  );
  const parentProject = env.NIGHTLY_CVE_PROJECT || "CVE";
  check(
    /^[A-Za-z0-9_-]+$/.test(parentProject),
    "Invalid parent YouTrack project",
  );
  for (const project of [...new Set([parentProject, cfg.youtrack_project])]) {
    const projects = await get(
      client,
      "admin/projects",
      { query: { query: project, fields: "id,shortName,archived", $top: 100 } },
      "YouTrack project access",
    );
    check(Array.isArray(projects), "Invalid YouTrack project response");
    const matches = projects.filter((item) => item.shortName === project);
    check(
      matches.length === 1 && matches[0].archived !== true,
      "YouTrack project is missing, inaccessible or archived",
    );
    const fields = await get(
      client,
      "admin/projects/" + encoded(matches[0].id) + "/customFields",
      { query: { fields: "field(name)", $top: 100 } },
      "YouTrack custom fields",
    );
    check(Array.isArray(fields), "Invalid YouTrack custom field response");
    const names = new Set(fields.map((field) => field.field?.name));
    const expected =
      project === parentProject
        ? ["CVE ID", "Severity", "Priority", "Type"]
        : [
            "Tester",
            "Статья учета времени",
            ...(cfg.subsystem ? ["Subsystem"] : []),
          ];
    const missing = expected.filter((name) => !names.has(name));
    check(
      !missing.length,
      "YouTrack project is missing required fields: " + missing.join(", "),
    );
    await get(
      client,
      "issues",
      { query: { query: `project: {${project}}`, fields: "id", $top: 1 } },
      "YouTrack issue read access",
    );
  }
  // GET access cannot prove create/update/link permission or workflow acceptance.
  reportPreflight(
    "security track",
    "youtrack-access",
    "проверены вход в YouTrack, проекты, поля и чтение",
  );
  return {
    identity: "verified",
    projects: "read_verified",
    required_fields: "verified",
    write_permissions: "checked_by_operations",
  };
}
async function checkRegistryAccess(
  namespace,
  { transport = request, probe } = {},
) {
  const host = namespace.split("/")[0];
  const base = httpsEndpoint("https://" + host, "Registry");
  let response;
  try {
    response = await transport(base + "/v2/", {
      timeout: 15000,
      limit: 1024 * 1024,
    });
  } catch {
    throw new PreflightError(
      "Registry is unavailable or TLS validation failed",
    );
  }
  check(
    response.status === 200 ||
      (response.status === 401 && !!response.headers?.get("www-authenticate")),
    "Registry v2 endpoint is unavailable",
  );
  // ORAS handles registry authentication; an exact target read distinguishes
  // auth failures from an empty/missing catalogue before upstream work begins.
  const existing = await probe();
  reportPreflight(
    "sbom catalog populate",
    "registry-access",
    "проверены доступность registry и чтение namespace",
  );
  return {
    endpoint: "reachable",
    authentication: "oras_login_completed",
    namespace_read: existing ? "verified" : "missing_or_hidden",
    push_permissions: "checked_by_publish",
  };
}
function checkExecutables(names, env = process.env) {
  for (const name of names) {
    const found = (env.PATH || "").split(path.delimiter).some((directory) => {
      const file = path.join(directory, name);
      try {
        return (
          fs.statSync(file).isFile() &&
          (fs.accessSync(file, fs.constants.X_OK), true)
        );
      } catch {
        return false;
      }
    });
    check(found, "Required executable is unavailable: " + name);
  }
}
module.exports = {
  checkExecutables,
  PreflightError,
  required,
  credentialPair,
  httpsEndpoint,
  checkGitlabAccess,
  checkYouTrackAccess,
  checkRegistryAccess,
};

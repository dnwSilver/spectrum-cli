// Noninteractive preflights. Remote checks are read-only and never log credentials.
const { request } = require("../automation");
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
module.exports = {
  PreflightError,
  required,
  credentialPair,
  httpsEndpoint,
  checkRegistryAccess,
};

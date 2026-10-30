// Read published registry metadata only; never pull/unpack or execute an image.
const { ensure, json, request, sha, DIGEST } = require("../automation");
const ACCEPT = [
  "application/vnd.oci.image.index.v1+json",
  "application/vnd.docker.distribution.manifest.list.v2+json",
  "application/vnd.oci.image.manifest.v1+json",
  "application/vnd.docker.distribution.manifest.v2+json",
].join(", ");
function imageReference(image) {
  ensure(typeof image === "string" && !/[\s?#\\]/.test(image), "Invalid image reference");
  const [name, digest, extra] = image.split("@");
  ensure(extra === undefined && (digest === undefined || DIGEST.test(digest)), "Invalid image digest");
  const colon = name.lastIndexOf(":"), slash = name.lastIndexOf("/");
  const tagged = colon > slash;
  const repository = tagged ? name.slice(0, colon) : name;
  const parts = repository.split("/");
  const explicitHost = parts.length > 1 && /[.:]|^localhost$/.test(parts[0]);
  let host = explicitHost ? parts.shift() : "registry-1.docker.io";
  if (["docker.io", "index.docker.io"].includes(host)) host = "registry-1.docker.io";
  if (host === "registry-1.docker.io" && parts.length === 1 && explicitHost)
    parts.unshift("library");
  if (!explicitHost && parts.length === 1) parts.unshift("library");
  ensure(/^[a-zA-Z0-9.-]+(?::\d+)?$/.test(host) && parts.every((part) => /^[a-z0-9]+(?:[._-]+[a-z0-9]+)*$/.test(part)), "Invalid image repository");
  const reference = digest || (tagged ? name.slice(colon + 1) : "latest");
  ensure(DIGEST.test(reference) || /^[\w][\w.-]{0,127}$/.test(reference), "Invalid image tag");
  return { host, repository: parts.join("/"), reference, name, tagged };
}
class Registry {
  constructor(env = process.env, transport = request) {
    this.env = env;
    this.transport = transport;
  }
  auth(host) {
    const e = this.env;
    if (host === e.CI_REGISTRY && e.CI_REGISTRY_USER && e.CI_REGISTRY_PASSWORD)
      return "Basic " + Buffer.from(e.CI_REGISTRY_USER + ":" + e.CI_REGISTRY_PASSWORD).toString("base64");
    if ((e.NIGHTLY_REGISTRY_HOSTS || "").split(",").includes(host) && e.NEXUS_USER && e.NEXUS_PASSWORD)
      return "Basic " + Buffer.from(e.NEXUS_USER + ":" + e.NEXUS_PASSWORD).toString("base64");
    return undefined;
  }
  async get(target, location, accept = "application/json") {
    const base = new URL("https://" + target.host).origin;
    const url = new URL(location, base);
    ensure(
      url.origin === base && !url.username && !url.password && !url.hash &&
        url.pathname.startsWith("/v2/" + target.repository + "/"),
      "Unsafe registry URL",
    );
    const headers = { Accept: accept, "User-Agent": "spectrum-security" };
    const auth = this.auth(target.host);
    if (auth) headers.Authorization = auth;
    const send = async (address, options) => {
      try { return await this.transport(address, options); }
      catch { throw new Error("Registry connection or TLS validation failed"); }
    };
    let response = await send(url.href, { headers });
    if (response.status === 401) {
      const challenge = response.headers.get("www-authenticate") || "";
      if (/^Bearer /i.test(challenge)) {
        const fields = Object.fromEntries([...challenge.matchAll(/(\w+)="([^"]*)"/g)].map((match) => [match[1], match[2]]));
        const realm = new URL(fields.realm);
        ensure(realm.protocol === "https:" && !realm.username && !realm.password && !realm.hash, "Unsafe registry token endpoint");
        if (fields.service) realm.searchParams.set("service", fields.service);
        realm.searchParams.set("scope", "repository:" + target.repository + ":pull");
        const tokenResponse = await send(realm.href, { headers: auth ? { Authorization: auth } : {} });
        ensure(tokenResponse.status === 200, `Registry token failed (HTTP ${tokenResponse.status})`);
        const body = json(tokenResponse.body), token = body.token || body.access_token;
        ensure(typeof token === "string" && token && !/[\r\n]/.test(token), "Invalid registry token");
        response = await send(url.href, { headers: { ...headers, Authorization: "Bearer " + token } });
      }
    }
    ensure(response.status === 200, `Registry read failed (HTTP ${response.status})`);
    return response;
  }
  async manifest(image) {
    const target = imageReference(image);
    const response = await this.get(target, `/v2/${target.repository}/manifests/${target.reference}`, ACCEPT);
    const digest = "sha256:" + sha(response.body);
    ensure(!DIGEST.test(target.reference) || target.reference === digest, "Registry manifest digest mismatch");
    const claimed = response.headers.get("docker-content-digest");
    ensure(!claimed || claimed === digest, "Registry digest header mismatch");
    const manifest = json(response.body);
    ensure(manifest.schemaVersion === 2, "Unsupported registry manifest");
    return { target, manifest, digest };
  }
  async immutableImage(image) {
    const { target, digest } = await this.manifest(image);
    return target.name + "@" + digest;
  }
  async tags(image) {
    const target = imageReference(image), tags = [];
    let location = `/v2/${target.repository}/tags/list?n=100`;
    const seen = new Set();
    while (location) {
      ensure(!seen.has(location) && seen.size < 1000, "Registry tag pagination did not finish");
      seen.add(location);
      const response = await this.get(target, location);
      const body = json(response.body);
      ensure(body.tags === null || (Array.isArray(body.tags) && body.tags.every((tag) => typeof tag === "string")), "Invalid registry tag list");
      tags.push(...(body.tags || []));
      location = (response.headers.get("link") || "").match(/<([^>]+)>;\s*rel="?next"?/)?.[1];
    }
    return tags;
  }
  async nodeVersion(image, platform, report) {
    let { target, manifest } = await this.manifest(image);
    const key = "com.google.distroless.nodejs.version";
    const versions = [manifest.annotations?.[key]];
    if (manifest.manifests) {
      const [os, architecture] = platform.split("/");
      const matches = manifest.manifests.filter((entry) => entry.platform?.os === os && entry.platform?.architecture === architecture);
      ensure(matches.length === 1 && DIGEST.test(matches[0].digest), "Runtime platform is missing or ambiguous");
      versions.push(matches[0].annotations?.[key]);
      ({ manifest } = await this.manifest(target.name + "@" + matches[0].digest));
      versions.push(manifest.annotations?.[key]);
    }
    const configs = [report?.Metadata?.ImageConfig?.config];
    if (!configs[0] && manifest.config?.digest) {
      const descriptor = manifest.config;
      ensure(DIGEST.test(descriptor.digest), "Invalid runtime config digest");
      const response = await this.get(target, `/v2/${target.repository}/blobs/${descriptor.digest}`);
      ensure("sha256:" + sha(response.body) === descriptor.digest, "Runtime config digest mismatch");
      ensure(descriptor.size === undefined || descriptor.size === response.body.length, "Runtime config size mismatch");
      configs.push(json(response.body).config);
    }
    for (const config of configs) {
      versions.push(config?.Labels?.[key]);
      for (const entry of config?.Env || [])
        if (typeof entry === "string" && entry.startsWith("NODE_VERSION=")) versions.push(entry.slice("NODE_VERSION=".length));
    }
    const found = [...new Set(versions.filter(Boolean).map((version) =>
      typeof version === "string" ? version.replace(/^v/, "") : version,
    ))];
    ensure(
      found.length === 1 && typeof found[0] === "string" &&
        /^\d+\.\d+\.\d+(?![\s\S])/.test(found[0]),
      "Cannot determine runtime Node.js version from published metadata (" + platform + "): " +
        (found.length ? "invalid or conflicting version values" :
          "missing " + key + " annotation/label and NODE_VERSION; publish a runtime image with version metadata"),
    );
    return found[0];
  }
}
module.exports = { Registry, imageReference };

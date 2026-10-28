const {
  ensure,
  safePath,
  SEMVER,
  HEX64,
  COMMIT,
  DIGEST,
} = require("../automation");
const GENERATION = "r2";
const CONFIG_TYPE = "application/vnd.spectrum.sbom-catalog.v1+json";
const OCI_TYPE = "application/vnd.oci.image.manifest.v1+json";
const MAX_PAYLOAD = 5 * 1024 * 1024;
const encoded = (value) =>
  encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
  );
const purl = (name, version) =>
  "pkg:npm/" + name.split("/").map(encoded).join("/") + "@" + encoded(version);
function canonicalRepository(value) {
  ensure(
    typeof value === "string" &&
      /^[a-z0-9][a-z0-9.-]*(?::[0-9]+)?\/[a-z0-9][a-z0-9._/-]*(?![\s\S])/.test(
        value,
      ) &&
      value
        .split("/")
        .slice(1)
        .every((p) => p && p !== "." && p !== ".."),
    "Invalid repository",
  );
  return value;
}
function validateCatalog(payload, version) {
  ensure(
    payload?.schemaVersion === 1 &&
      payload.kind === "vendored-package-catalog" &&
      payload.generation === GENERATION,
    "Unsupported catalog",
  );
  const owner = payload.owner || {};
  ensure(
    owner.name === "next" &&
      owner.version === version &&
      owner.purl === purl("next", version),
    "Catalog owner mismatch",
  );
  ensure(
    typeof owner.manifestSha256 === "string" &&
      HEX64.test(owner.manifestSha256) &&
      typeof owner.sourceCommit === "string" &&
      COMMIT.test(owner.sourceCommit),
    "Missing catalog provenance",
  );
  ensure(
    typeof owner.integrity === "string" &&
      /^sha512-[A-Za-z0-9+/]+={0,2}(?![\s\S])/.test(owner.integrity) &&
      Buffer.from(owner.integrity.slice(7), "base64").length === 64 &&
      Buffer.from(owner.integrity.slice(7), "base64").toString("base64") ===
        owner.integrity.slice(7),
    "Invalid npm integrity",
  );
  ensure(
    Array.isArray(payload.components) && Array.isArray(payload.unresolved),
    "Invalid catalog entries",
  );
  const paths = [];
  for (const component of payload.components) {
    const name = component.path;
    ensure(
      safePath(name) &&
        name.startsWith("dist/compiled/") &&
        !paths.some(
          (p) =>
            p === name || p.startsWith(name + "/") || name.startsWith(p + "/"),
        ),
      "Invalid component path",
    );
    paths.push(name);
    ensure(
      typeof component.version === "string" &&
        SEMVER.test(component.version) &&
        typeof component.name === "string" &&
        component.name &&
        component.evidence,
      "Invalid catalog component",
    );
    const evidence = component.evidence;
    ensure(
      component.purl === purl(component.name, component.version) &&
        typeof evidence.commit === "string" &&
        COMMIT.test(evidence.commit) &&
        safePath(evidence.sourcePath) &&
        safePath(evidence.lockfile) &&
        typeof evidence.resolution === "string" &&
        evidence.resolution,
      "Invalid component provenance",
    );
    const files = component.files;
    ensure(
      files &&
        typeof files === "object" &&
        !Array.isArray(files) &&
        Object.hasOwn(files, "package.json") &&
        Object.keys(files).some((p) =>
          /\.(js|mjs|cjs|wasm|node)(?![\s\S])/.test(p),
        ),
      "Incomplete file inventory",
    );
    for (const [name, hash] of Object.entries(files))
      ensure(
        safePath(name) && typeof hash === "string" && HEX64.test(hash),
        "Unsafe catalog file",
      );
  }
  for (const entry of payload.unresolved)
    ensure(
      entry &&
        safePath(entry.path) &&
        typeof entry.reason === "string" &&
        entry.reason,
      "Invalid unresolved catalog entry",
    );
  return payload;
}
function validateManifest(manifest) {
  ensure(
    manifest?.schemaVersion === 2 &&
      manifest.mediaType === OCI_TYPE &&
      manifest.config?.mediaType === CONFIG_TYPE,
    "Unsupported OCI catalog manifest",
  );
  const config = manifest.config;
  ensure(
    typeof config.digest === "string" &&
      DIGEST.test(config.digest) &&
      Number.isInteger(config.size) &&
      config.size >= 0 &&
      config.size <= MAX_PAYLOAD,
    "Invalid catalog config descriptor",
  );
  ensure(
    Array.isArray(manifest.layers) && manifest.layers.length === 1,
    "Catalog must contain one JSON layer",
  );
  const layer = manifest.layers[0];
  ensure(
    layer.mediaType === "application/json" &&
      layer.annotations?.["org.opencontainers.image.title"] ===
        "catalog.json" &&
      typeof layer.digest === "string" &&
      DIGEST.test(layer.digest) &&
      Number.isInteger(layer.size) &&
      layer.size > 0 &&
      layer.size <= MAX_PAYLOAD,
    "Unsafe catalog layer",
  );
  return layer;
}
module.exports = {
  GENERATION,
  CONFIG_TYPE,
  OCI_TYPE,
  MAX_PAYLOAD,
  encoded,
  purl,
  canonicalRepository,
  validateCatalog,
  validateManifest,
};

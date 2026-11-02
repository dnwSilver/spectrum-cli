const { sha } = require("../../src/automation");
const { Registry, imageReference } = require("../../src/security/registry");
const image = "registry.example:5443/team/runtime:24.1.0.1";
const body = Buffer.from(JSON.stringify({ schemaVersion: 2, config: {}, layers: [] }));
const digest = "sha256:" + sha(body);
const response = (value = body, headers = {}, status = 200) => ({
  status, headers: new Headers(headers),
  body: Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value)),
});
test.each([
  [image, "registry.example:5443", "team/runtime", "24.1.0.1"],
  [image + "@" + digest, "registry.example:5443", "team/runtime", digest],
  ["node:24", "registry-1.docker.io", "library/node", "24"],
  ["docker.io/node:24", "registry-1.docker.io", "library/node", "24"],
  ["docker.io/team/node:24", "registry-1.docker.io", "team/node", "24"],
  ["team/node", "registry-1.docker.io", "team/node", "latest"],
])("image reference separates port, tag and digest: %s", (value, host, repository, reference) => {
  expect(imageReference(value)).toMatchObject({ host, repository, reference });
});
test.each(["https://host/path", "host/a/../b", image + "\n", image + "@invalid", "host/a@" + digest + "@" + digest])("invalid registry reference is rejected: %s", (value) => {
  expect(() => imageReference(value)).toThrow();
});
test("digest resolution hashes the manifest and pinned reads omit tag without losing report metadata", async () => {
  const transport = jest.fn(async () => response(body, { "docker-content-digest": digest }));
  const registry = new Registry({}, transport);
  expect(await registry.immutableImage(image)).toBe(image + "@" + digest);
  expect(await registry.immutableImage(image + "@" + digest)).toBe(image + "@" + digest);
  expect(transport.mock.calls.map(([url]) => url)).toEqual([
    "https://registry.example:5443/v2/team/runtime/manifests/24.1.0.1",
    "https://registry.example:5443/v2/team/runtime/manifests/" + digest,
  ]);
  const bad = "sha256:" + "0".repeat(64);
  await expect(registry.immutableImage(image + "@" + bad)).rejects.toThrow("digest mismatch");
  transport.mockResolvedValue(response(body, { "docker-content-digest": bad }));
  await expect(registry.immutableImage(image)).rejects.toThrow("header mismatch");
});
test("registry read negotiates pull-only Bearer auth with configured host credentials", async () => {
  const env = { NIGHTLY_REGISTRY_HOSTS: "registry.example:5443", NEXUS_USER: "user", NEXUS_PASSWORD: "secret" };
  const transport = jest.fn()
    .mockResolvedValueOnce(response({}, { "www-authenticate": 'Bearer realm="https://auth.example/token",service="registry",scope="repository:unrelated:push,pull"' }, 401))
    .mockResolvedValueOnce(response({ access_token: "bearer-token" }))
    .mockResolvedValueOnce(response());
  await new Registry(env, transport).immutableImage(image);
  const [url, options] = transport.mock.calls[1];
  expect(new URL(url).searchParams.get("scope")).toBe("repository:team/runtime:pull");
  expect(options.headers.Authorization).toBe("Basic " + Buffer.from("user:secret").toString("base64"));
  expect(transport.mock.calls[2][1].headers.Authorization).toBe("Bearer bearer-token");
  expect(new Registry(env).auth("unrelated.example")).toBeUndefined();
});
test.each(["http://auth.example/token", "https://user:password@auth.example/token"])("unsafe token realm is rejected: %s", async (realm) => {
  const transport = jest.fn(async () => response({}, { "www-authenticate": `Bearer realm="${realm}"` }, 401));
  await expect(new Registry({}, transport).immutableImage(image)).rejects.toThrow("Unsafe registry token");
  expect(transport).toHaveBeenCalledTimes(1);
});
test("tags are paginated and credentials never follow a cross-origin link", async () => {
  const transport = jest.fn()
    .mockResolvedValueOnce(response({ tags: ["24.1.0.2"] }, { link: '</v2/team/runtime/tags/list?n=1&last=24.1.0.2>; rel="next"' }))
    .mockResolvedValueOnce(response({ tags: ["24.1.0.3"] }));
  expect(await new Registry({}, transport).tags(image)).toEqual(["24.1.0.2", "24.1.0.3"]);
  transport.mockReset().mockResolvedValue(response({ tags: [] }, { link: '<https://unrelated.example/v2/team/runtime/tags/list>; rel="next"' }));
  await expect(new Registry({}, transport).tags(image)).rejects.toThrow("Unsafe registry URL");
  expect(transport).toHaveBeenCalledTimes(1);
});
test("Node version comes from the selected platform's immutable manifest without running binaries", async () => {
  const platform = Buffer.from(JSON.stringify({ schemaVersion: 2, annotations: { "com.google.distroless.nodejs.version": "24.22.1" } }));
  const platformDigest = "sha256:" + sha(platform);
  const transport = jest.fn()
    .mockResolvedValueOnce(response({ schemaVersion: 2, manifests: [
      { digest: platformDigest, platform: { os: "linux", architecture: "arm64" } },
      { digest: "sha256:" + "1".repeat(64), platform: { os: "linux", architecture: "amd64" } },
    ] }))
    .mockResolvedValueOnce(response(platform));
  expect(await new Registry({}, transport).nodeVersion(image, "linux/arm64", {})).toBe("24.22.1");
  expect(transport.mock.calls[1][0]).toContain("/manifests/" + platformDigest);
});
test("Node version uses scanned image config; missing/conflicting metadata never means clean", async () => {
  const registry = new Registry({}, async () => response());
  const report = { Metadata: { ImageConfig: { config: { Env: ["NODE_VERSION=24.22.1"] } } } };
  expect(await registry.nodeVersion(image, "linux/amd64", report)).toBe("24.22.1");
  await expect(registry.nodeVersion(image, "linux/amd64", {})).rejects.toThrow("published metadata");
  report.Metadata.ImageConfig.config.Env = ["NODE_VERSION=24.22.1\n"];
  await expect(registry.nodeVersion(image, "linux/amd64", report)).rejects.toThrow("published metadata");
  report.Metadata.ImageConfig.config.Env = ["NODE_VERSION=24.22.1"];
  report.Metadata.ImageConfig.config.Env.push("NODE_VERSION=24.1.0");
  await expect(registry.nodeVersion(image, "linux/amd64", report)).rejects.toThrow("published metadata");
});
test("registry failures expose status without response secrets", async () => {
  const registry = new Registry({}, async () => response({ secret: "private-value" }, {}, 403));
  await expect(registry.immutableImage(image)).rejects.toThrow("HTTP 403");
  await expect(registry.immutableImage(image)).rejects.not.toThrow("private-value");
});
test("Node version reads the digest-verified config blob when Trivy omits image config", async () => {
  const config = Buffer.from(JSON.stringify({ config: { Labels: { "com.google.distroless.nodejs.version": "24.22.1" } } }));
  const configDigest = "sha256:" + sha(config);
  const transport = jest.fn()
    .mockResolvedValueOnce(response({ schemaVersion: 2, config: { digest: configDigest, size: config.length } }))
    .mockResolvedValueOnce(response(config));
  expect(await new Registry({}, transport).nodeVersion(image, "linux/amd64", {})).toBe("24.22.1");
  expect(transport.mock.calls[1][0]).toBe("https://registry.example:5443/v2/team/runtime/blobs/" + configDigest);
});
test("config tampering, size mismatch and conflicting manifest metadata fail closed", async () => {
  const config = Buffer.from(JSON.stringify({ config: { Env: ["NODE_VERSION=24.22.1"] } }));
  const descriptor = { digest: "sha256:" + sha(config), size: config.length };
  const check = (value, configBody, annotations = {}) => new Registry({}, jest.fn()
    .mockResolvedValueOnce(response({ schemaVersion: 2, config: value, annotations }))
    .mockResolvedValueOnce(response(configBody))).nodeVersion(image, "linux/amd64", {});
  await expect(check(descriptor, {})).rejects.toThrow("config digest mismatch");
  await expect(check({ ...descriptor, size: config.length + 1 }, config)).rejects.toThrow("config size mismatch");
  await expect(check(descriptor, config, { "com.google.distroless.nodejs.version": "25.0.0" })).rejects.toThrow("conflicting version");
});
test("existing Trivy config metadata does not require another registry blob request", async () => {
  const transport = jest.fn(async () => response({ schemaVersion: 2, config: { digest } }));
  const report = { Metadata: { ImageConfig: { config: { Env: ["NODE_VERSION=24.22.1"] } } } };
  expect(await new Registry({}, transport).nodeVersion(image, "linux/amd64", report)).toBe("24.22.1");
  expect(transport).toHaveBeenCalledTimes(1);
});
test("missing version identifies the platform and the runtime publication fix", async () => {
  await expect(new Registry({}, async () => response()).nodeVersion(image, "linux/amd64", {}))
    .rejects.toThrow("linux/amd64): missing com.google.distroless.nodejs.version annotation/label and NODE_VERSION; publish a runtime image");
});

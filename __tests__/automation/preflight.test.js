const { fs, path, temp, remove, read } = require("../../src/automation");
const { required, credentialPair, httpsEndpoint, checkRegistryAccess } = require("../../src/preflight/automation");
const { execute: resolve } = require("../../src/sbom/resolve");
const { Publisher } = require("../../src/sbom/populate");
let dirs;
beforeEach(() => { dirs = []; });
afterEach(() => dirs.forEach(remove));
const directory = () => { const dir = temp("automation-preflight-"); dirs.push(dir); return dir; };
test("missing variables are reported together without exposing values", () => {
  expect(() =>
    required({ TOKEN: "do-not-log" }, ["URL", "TOKEN", "PROJECT"]),
  ).toThrow("URL, PROJECT");
  expect(() => credentialPair({ USER: "bot" }, "USER", "PASSWORD")).toThrow(
    "both USER and PASSWORD",
  );
});
test.each([
  "",
  "http://issues.example.com",
  "https://user:secret@issues.example.com",
  "https://issues.example.com?token=secret",
  "https://issues.example.com\n",
])("reject invalid endpoint without echoing it: %s", (value) => {
  try {
    httpsEndpoint(value, "REGISTRY_URL");
    throw Error("unexpected success");
  } catch (error) {
    expect(error.message).toContain("REGISTRY_URL");
    expect(error.message).not.toContain("secret");
  }
});
test("registry auth/namespace failures abort preflight without push; empty namespace is not permission proof", async () => {
  const probe = jest.fn(() => null),
    transport = jest.fn(async () => ({ status: 200, headers: new Headers() }));
  expect(
    await checkRegistryAccess("registry.example.com/catalog/next", {
      probe,
      transport,
    }),
  ).toMatchObject({
    namespace_read: "missing_or_hidden",
    push_permissions: "checked_by_publish",
  });
  transport.mockResolvedValue({ status: 503, headers: new Headers() });
  probe.mockClear();
  await expect(
    checkRegistryAccess("registry.example.com/catalog/next", {
      probe,
      transport,
    }),
  ).rejects.toThrow("unavailable");
  expect(probe).not.toHaveBeenCalled();
  transport.mockResolvedValue({ status: 200, headers: new Headers() });
  probe.mockImplementation(() => {
    throw Error("Catalog lookup failed");
  });
  await expect(
    checkRegistryAccess("registry.example.com/catalog/next", {
      probe,
      transport,
    }),
  ).rejects.toThrow("Catalog lookup");
});
test("missing catalogue configuration fails before tool bootstrap", async () => {
  const bootstrap = jest.fn(),
    result = await resolve(
      { SBOM_CATALOG_CLIENT_ENABLED: "true", SBOM_CATALOG_FRAMEWORK: "nextjs" },
      directory(),
      { bootstrap },
    );
  expect(bootstrap).not.toHaveBeenCalled();
  expect(result.errors[0]).toContain("SBOM_CATALOG_REPOSITORY");
});
test("writer requires explicit namespace and credentials before bootstrap or registry use", async () => {
  const bootstrap = jest.fn();
  const publisher = new Publisher(
    {
      NEXT_CATALOG_VERSIONS: '["1.2.3"]',
      CI_COMMIT_BRANCH: "main",
      CI_COMMIT_REF_PROTECTED: "true",
    },
    { bootstrap },
  );
  const cwd = directory();
  expect(await publisher.main({ cwd })).toBe(2);
  expect(bootstrap).not.toHaveBeenCalled();
  expect(
    read(path.join(cwd, "sbom-catalog-updater/report.json")).error,
  ).toContain("SBOM_CATALOG_PUBLISH_REPOSITORY");
});

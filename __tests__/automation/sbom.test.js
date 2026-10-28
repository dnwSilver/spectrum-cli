const io = require("../../src/automation");
const { fs, path, temp, remove, sha, json, exec, read } = io;
const schema = require("../../src/sbom/schema");
const client = require("../../src/sbom/resolve");
const {
  Publisher,
  Git,
  versions,
  publicationRepository,
} = require("../../src/sbom/populate");
const provenance = require("../../src/sbom/provenance");
const { TOOLS } = require("../../src/sbom/tools");
const IMAGE_DIGEST = "sha256:" + "a".repeat(64),
  CATALOG_REF = "registry.example/sbom/next@sha256:" + "b".repeat(64);
const ENV = {
  SBOM_CATALOG_CLIENT_ENABLED: "true",
  SBOM_CATALOG_FRAMEWORK: "nextjs",
  SBOM_CATALOG_UPDATER_PROJECT: "automation/catalog",
  SBOM_CATALOG_REPOSITORY: "registry.example.com/catalog",
  DOCKER_IMAGE: "registry.example/team/site",
  APP_VERSION: "1.2.3-rc.1",
  CI_REGISTRY: "registry.example",
  CI_JOB_TOKEN: "fake-token",
  CI_SERVER_URL: "https://gitlab.example",
  CI_API_V4_URL: "https://gitlab.example/api/v4",
};
const pkg = (version = "99.1.2", root = "/app/node_modules/next") => ({
  name: "next",
  type: "npm",
  version,
  locations: [{ path: root + "/package.json" }],
});
const sbom = (packages = [pkg()]) => ({
  source: {
    type: "image",
    metadata: { manifestDigest: IMAGE_DIGEST, repoDigests: [] },
  },
  artifacts: packages,
});
const catalog = () => ({
  schemaVersion: 1,
  kind: "vendored-package-catalog",
  generation: "r2",
  owner: {
    name: "next",
    version: "99.1.2",
    purl: "pkg:npm/next@99.1.2",
    manifestSha256: "c".repeat(64),
    integrity: "sha512-" + Buffer.alloc(64, "x").toString("base64"),
    sourceCommit: "d".repeat(40),
  },
  components: [
    {
      path: "dist/compiled/a",
      name: "a",
      version: "1.2.3",
      purl: "pkg:npm/a@1.2.3",
      files: { "package.json": "e".repeat(64), "index.js": "f".repeat(64) },
      evidence: {
        commit: "d".repeat(40),
        sourcePath: "packages/next/src/compiled/a",
        lockfile: "pnpm-lock.yaml",
        resolution: "a@1.2.3",
      },
    },
  ],
  unresolved: [],
});
let directories;
beforeEach(() => {
  directories = [];
});
afterEach(() => directories.forEach(remove));
const dir = () => {
  const d = temp("spectrum-sbom-test-");
  directories.push(d);
  return d;
};
async function discover({
  inventory = sbom(),
  lookup = () => CATALOG_REF,
  trigger = async () => "https://gitlab.example/pipelines/1",
  env = ENV,
} = {}) {
  const run = jest.fn((command) =>
    JSON.stringify(
      command[0] === "oras" ? { digest: IMAGE_DIGEST } : inventory,
    ),
  );
  const deps = {
    run,
    bootstrap: jest.fn(),
    catalogRef: jest.fn(lookup),
    trigger: jest.fn(trigger),
  };
  const result = await client.execute(env, dir(), deps);
  return { ...result, deps };
}
test("immutable image cache hit, no downstream request", async () => {
  const { selection, errors, deps } = await discover();
  expect(selection.status).toBe("complete");
  expect(errors).toEqual([]);
  expect(selection.catalogs[0].ref).toBe(CATALOG_REF);
  expect(deps.trigger).not.toHaveBeenCalled();
  expect(deps.run.mock.calls[1][0]).toContain(
    "registry:" + ENV.DOCKER_IMAGE + "@" + IMAGE_DIGEST,
  );
});
test("multiple missing versions produce one bounded request and multiple roots", async () => {
  const { selection, deps } = await discover({
    inventory: sbom([
      pkg(),
      pkg("99.1.3", "/nested/node_modules/next"),
      pkg("99.1.3", "/other/node_modules/next"),
    ]),
    lookup: () => {
      throw new client.MissingCatalog();
    },
  });
  expect(selection.status).toBe("partial");
  expect(selection.missing).toHaveLength(3);
  expect(deps.catalogRef).toHaveBeenCalledTimes(2);
  expect(deps.trigger).toHaveBeenCalledTimes(1);
  expect(deps.trigger.mock.calls[0][0]).toEqual(["99.1.2", "99.1.3"]);
});
test("request or lookup failure retains valid hits and does not expose secrets", async () => {
  let calls = 0;
  const { selection, errors } = await discover({
    inventory: sbom([pkg(), pkg("99.1.3", "/other/node_modules/next")]),
    lookup: () => {
      if (calls++) throw new client.MissingCatalog();
      return CATALOG_REF;
    },
    trigger: () => {
      throw Error("secret");
    },
  });
  expect(selection.catalogs).toHaveLength(1);
  expect(selection.request.status).toBe("failed");
  expect(JSON.stringify(errors)).not.toContain("secret");
  const broken = await discover({
    lookup: () => {
      throw Error("secret");
    },
  });
  expect(broken.deps.trigger).not.toHaveBeenCalled();
  expect(broken.errors.length).toBeGreaterThan(0);
});
test("digest mismatch, unknown versions and absent installed manifests do not request", async () => {
  const wrong = sbom();
  wrong.source.metadata.manifestDigest = "sha256:" + "0".repeat(64);
  for (const inventory of [
    wrong,
    sbom([pkg("UNKNOWN")]),
    sbom([{ ...pkg(), locations: [{ path: "/app/package-lock.json" }] }]),
  ]) {
    const result = await discover({ inventory });
    expect(result.selection.status).toBe("error");
    expect(result.deps.trigger).not.toHaveBeenCalled();
  }
  expect(
    client.discover(sbom([pkg("1.2.3", "/app/../node_modules/next")])),
  ).toEqual([]);
});
test("disabled framework and catalogue perform no downloads", async () => {
  for (const env of [
    { ...ENV, SBOM_CATALOG_CLIENT_ENABLED: "false" },
    { ...ENV, SBOM_CATALOG_FRAMEWORK: "" },
  ]) {
    const result = await discover({ env });
    expect(result.selection.status).toBe("skipped");
    expect(result.deps.bootstrap).not.toHaveBeenCalled();
  }
});
function oci(payload = catalog(), mutate = () => {}) {
  const body = Buffer.from(JSON.stringify(payload));
  const manifest = {
    schemaVersion: 2,
    mediaType: schema.OCI_TYPE,
    config: {
      mediaType: schema.CONFIG_TYPE,
      digest: "sha256:" + sha("{}"),
      size: 2,
    },
    layers: [
      {
        mediaType: "application/json",
        digest: "sha256:" + sha(body),
        size: body.length,
        annotations: { "org.opencontainers.image.title": "catalog.json" },
      },
    ],
  };
  mutate(manifest);
  const wire = Buffer.from(JSON.stringify(manifest)),
    digest = "sha256:" + sha(wire);
  return { body, wire, digest };
}
function resolveOCI({
  payload = catalog(),
  mutate,
  corrupt = false,
  wrongDigest = false,
} = {}) {
  const { body, wire, digest } = oci(payload, mutate);
  const run = (command) =>
    command.includes("--descriptor")
      ? JSON.stringify({
          digest: wrongDigest ? IMAGE_DIGEST : digest,
          mediaType: schema.OCI_TYPE,
        })
      : command.includes("blob")
        ? corrupt
          ? Buffer.from("bad")
          : body
        : wire;
  return client.catalogRef(ENV.SBOM_CATALOG_REPOSITORY, "99.1.2", {}, run);
}
test("OCI manifest and payload both bound to digest; publisher reads old valid records", () => {
  expect(resolveOCI()).toContain("/next@sha256:");
  const fixture = oci(),
    publisher = new Publisher({
      SBOM_CATALOG_PUBLISH_REPOSITORY: "registry.example.com/catalog",
    });
  publisher.oras = jest
    .fn()
    .mockReturnValueOnce(fixture.wire)
    .mockReturnValueOnce(fixture.body);
  expect(publisher.readback(fixture.digest, "99.1.2", fixture.body)).toEqual(
    catalog(),
  );
  for (const options of [
    { corrupt: true },
    { wrongDigest: true },
    { mutate: (m) => m.layers.push(m.layers[0]) },
    { mutate: (m) => (m.config.mediaType = "unsafe") },
    {
      mutate: (m) =>
        (m.layers[0].annotations["org.opencontainers.image.title"] =
          "../catalog.json"),
    },
  ])
    expect(() => resolveOCI(options)).toThrow();
});
test.each([
  "owner",
  "generation",
  "paths",
  "provenance",
  "overlap",
  "inventory",
  "integrity",
])("rejects invalid catalogue %s", (which) => {
  const payload = catalog();
  if (which === "owner") payload.owner.version = "99.1.3";
  if (which === "generation") payload.generation = "r1";
  if (which === "paths")
    payload.components[0].files["../secret"] = "a".repeat(64);
  if (which === "provenance") payload.components[0].evidence.commit = "main";
  if (which === "overlap")
    payload.components.push({
      ...payload.components[0],
      path: "dist/compiled/a/nested",
    });
  if (which === "inventory") delete payload.components[0].files["index.js"];
  if (which === "integrity") payload.owner.integrity = "sha512-invalid";
  expect(() => resolveOCI({ payload })).toThrow();
});
test("trigger performs one POST, passes only inputs and never sends token to untrusted host", async () => {
  const transport = jest.fn(async () => ({
    status: 201,
    body: Buffer.from('{"web_url":"https://gitlab.example/pipelines/1"}'),
  }));
  await client.trigger(["99.1.2"], ENV, transport);
  expect(transport).toHaveBeenCalledTimes(1);
  const [url, options] = transport.mock.calls[0];
  expect(url).toContain("automation%2Fcatalog/trigger/pipeline");
  expect(options.method).toBe("POST");
  expect(Object.keys(JSON.parse(options.body)).sort()).toEqual([
    "inputs",
    "ref",
    "token",
  ]);
  transport.mockClear();
  await expect(
    client.trigger(
      ["99.1.2"],
      { ...ENV, CI_API_V4_URL: "https://evil/api/v4" },
      transport,
    ),
  ).rejects.toThrow();
  await expect(
    client.trigger(Array(11).fill("99.1.2"), ENV, transport),
  ).rejects.toThrow();
  expect(transport).not.toHaveBeenCalled();
});
test("resolve always writes compatible reports, even when tool bootstrap fails", async () => {
  const root = dir();
  expect(
    await client.resolve({
      cwd: root,
      env: ENV,
      deps: {
        bootstrap: () => {
          throw Error("secret");
        },
      },
    }),
  ).toBe(2);
  const output = path.join(root, "sbom-catalog/site:");
  expect(fs.readdirSync(output).sort()).toEqual([
    "report.json",
    "report.md",
    "selection.json",
  ]);
  expect(
    fs.readFileSync(path.join(output, "report.json"), "utf8"),
  ).not.toContain("secret");
});
test("writer requires protected main and central credentials before any IO", async () => {
  const publisher = new Publisher({
    SBOM_CATALOG_PUBLISH_REPOSITORY: "registry.example.com/catalog",
    NEXT_CATALOG_VERSIONS: '["99.1.2"]',
    CI_COMMIT_BRANCH: "main",
    CI_COMMIT_REF_PROTECTED: "true",
    NEXUS_PASSWORD: "secret",
  });
  publisher.oras = jest.fn();
  expect(await publisher.main({ cwd: dir() })).toBe(2);
  expect(publisher.oras).not.toHaveBeenCalled();
});
test("writer distinguishes network errors, publishes partial provenance and reuses immutable cache", async () => {
  const publisher = new Publisher(
    {
      SBOM_CATALOG_PUBLISH_REPOSITORY: "registry.example.com/catalog",
      NEXT_CATALOG_VERSIONS: '["99.1.2"]',
      CI_COMMIT_BRANCH: "main",
      CI_COMMIT_REF_PROTECTED: "true",
      NEXUS_USER: "writer",
      NEXUS_PASSWORD: "secret",
    },
    {
      bootstrap: async () => {},
      checkRegistryAccess: async () => ({
        namespace_read: "verified",
        push_permissions: "checked_by_publish",
      }),
      git: {},
    },
  );
  publisher.oras = jest.fn();
  publisher.descriptor = () => null;
  publisher.publish = jest.fn(() => "immutable");
  publisher.buildCatalog = async () => {
    throw Error("network unavailable");
  };
  expect(await publisher.main({ cwd: dir() })).toBe(2);
  expect(publisher.publish).not.toHaveBeenCalled();
  publisher.buildCatalog = async () => ({
    components: [{}],
    unresolved: [
      { path: "dist/compiled/custom", reason: "unsupported recipe" },
    ],
  });
  expect(await publisher.main({ cwd: dir() })).toBe(2);
  expect(publisher.publish).toHaveBeenCalledTimes(1);
  const cached = new Publisher({
    SBOM_CATALOG_PUBLISH_REPOSITORY: "registry.example.com/catalog",
  });
  cached.descriptor = () => IMAGE_DIGEST;
  cached.readback = jest.fn();
  cached.oras = jest.fn();
  expect(cached.publish("99.1.2", {}, "/unused")).toContain(IMAGE_DIGEST);
  expect(cached.oras).not.toHaveBeenCalled();
});
test("publisher readback validates exact generated payload before accepting publication", () => {
  const publisher = new Publisher({
      SBOM_CATALOG_PUBLISH_REPOSITORY: "registry.example.com/catalog",
    }),
    fixture = oci();
  publisher.oras = jest
    .fn()
    .mockReturnValueOnce(fixture.wire)
    .mockReturnValueOnce(fixture.body);
  expect(() =>
    publisher.readback(fixture.digest, "99.1.2", Buffer.from("different")),
  ).toThrow("differs");
});
test("historical SHA-512 or SHA-1 must match official npm metadata", async () => {
  const publisher = new Publisher({
    SBOM_CATALOG_PUBLISH_REPOSITORY: "registry.example.com/catalog",
  });
  publisher.download = async () =>
    Buffer.from(
      JSON.stringify({
        name: "widget",
        version: "1.2.3",
        dist: { integrity: "sha512-abc", shasum: "ab".repeat(20) },
      }),
    );
  await publisher.verifyRegistry("widget", "1.2.3", {
    integrity: "sha512-abc",
  });
  await publisher.verifyRegistry("widget", "1.2.3", {
    integrity: "sha1-" + Buffer.from("ab".repeat(20), "hex").toString("base64"),
  });
  await expect(
    publisher.verifyRegistry("widget", "1.2.3", { integrity: "sha512-fork" }),
  ).rejects.toThrow("differs");
});
test("official downloads reject HTTP, redirects and alternate registries", async () => {
  const transport = jest.fn(async () => ({
      status: 302,
      body: Buffer.alloc(0),
    })),
    publisher = new Publisher({}, { request: transport });
  for (const url of [
    "http://registry.npmjs.org/a",
    "https://evil.invalid/a",
    "https://u@registry.npmjs.org/a",
    "https://registry.npmjs.org:443/a",
  ])
    await expect(publisher.download(url, 10)).rejects.toThrow("official");
  expect(transport).not.toHaveBeenCalled();
  await expect(
    publisher.download("https://registry.npmjs.org/a", 10),
  ).rejects.toThrow("redirect");
});
const recipe = (target = "compiled/widget", externals = "externals") =>
  `export async function ncc_widget(task, opts) {\n  await task\n    .source(relative(__dirname, require.resolve('widget')))\n    .ncc({ packageName: 'widget', externals: ${externals}, target: 'es5' })\n    .target('${target}')\n}\n`;
test.each(["externals", "{ ...externals, helper: 'next/dist/lib/helper' }"])(
  "provenance uses actual historical rebuild after lock bump and exact rename: %s",
  async (externals) => {
    const root = dir(),
      env = {
        ...process.env,
        GIT_AUTHOR_NAME: "Test",
        GIT_AUTHOR_EMAIL: "test@example.invalid",
        GIT_COMMITTER_NAME: "Test",
        GIT_COMMITTER_EMAIL: "test@example.invalid",
      };
    const command = (...args) =>
      exec(["git", "-c", "core.hooksPath=/dev/null", ...args], {
        cwd: root,
        env,
      }).stdout.trim();
    const put = (file, text) => {
      const target = path.join(root, file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, text);
    };
    const commit = (msg) => {
      command("add", ".");
      command("commit", "-qm", msg);
      return command("rev-parse", "HEAD");
    };
    command("init", "-q");
    put("README", "fixture");
    commit("initial");
    put(
      "packages/next/compiled/widget/package.json",
      '{"name":"widget","main":"index.js"}',
    );
    put("packages/next/compiled/widget/index.js", "module.exports = 123");
    put("packages/next/compiled/widget/LICENSE", "license");
    put("packages/next/taskfile.js", recipe("compiled/widget", externals));
    const lock = (version) =>
      JSON.stringify({
        importers: {
          "packages/next": {
            devDependencies: { widget: { specifier: version, version } },
          },
        },
        packages: {
          ["widget@" + version]: { resolution: { integrity: "sha512-abc" } },
        },
      });
    put("packages/next/package.json", '{"devDependencies":{"widget":"1.2.3"}}');
    put("pnpm-lock.yaml", lock("1.2.3"));
    const rebuild = commit("actual bundle rebuild");
    put("packages/next/package.json", '{"devDependencies":{"widget":"9.9.9"}}');
    put("pnpm-lock.yaml", lock("9.9.9"));
    commit("lock bump without code rebuild");
    fs.mkdirSync(path.join(root, "packages/next/src"));
    command("mv", "packages/next/compiled", "packages/next/src/compiled");
    put("packages/next/taskfile.js", recipe("src/compiled/widget", externals));
    const release = commit("move without rebuild");
    const git = Object.create(Git.prototype);
    Object.assign(git, { directory: root, env, remaining: (limit) => limit });
    const compiled = path.join(root, "packages/next/src/compiled/widget"),
      contents = Object.fromEntries(
        fs
          .readdirSync(compiled)
          .map((name) => [name, fs.readFileSync(path.join(compiled, name))]),
      );
    const verify = jest.fn();
    const result = await provenance.resolveComponent(
      git,
      release,
      "dist/compiled/widget",
      { name: "widget" },
      contents,
      verify,
    );
    expect(result.version).toBe("1.2.3");
    expect(result.evidence.commit).toBe(rebuild);
    expect(verify).toHaveBeenCalledWith("widget", "1.2.3", {
      locator: "1.2.3",
      integrity: "sha512-abc",
    });
    contents["index.js"] = Buffer.from("changed");
    await expect(
      provenance.resolveComponent(
        git,
        release,
        "dist/compiled/widget",
        { name: "widget" },
        contents,
        verify,
      ),
    ).rejects.toThrow("release Git tree");
  },
);
test("PNPM nearest importer, scoped aliases, patches, forks and Yarn exact keys", () => {
  const fake = (files) => ({
    show: (_, file) =>
      files[file] === undefined
        ? null
        : Buffer.from(
            typeof files[file] === "string"
              ? files[file]
              : JSON.stringify(files[file]),
          ),
  });
  const lock = {
    importers: {
      "packages/next": {
        devDependencies: { widget: { specifier: "^1.0.0", version: "1.2.3" } },
      },
    },
    packages: { "widget@1.2.3": { resolution: { integrity: "sha512-abc" } } },
  };
  const files = {
    "packages/next/package.json": { devDependencies: { widget: "^1.0.0" } },
    "package.json": { devDependencies: { widget: "9.9.9" } },
    "pnpm-lock.yaml": lock,
  };
  expect(
    provenance.lockResolution(fake(files), "abc", "widget").slice(0, 2),
  ).toEqual(["widget", "1.2.3"]);
  lock.patchedDependencies = { "widget@1.2.3": {} };
  expect(() => provenance.lockResolution(fake(files), "abc", "widget")).toThrow(
    "patch",
  );
  delete files["pnpm-lock.yaml"];
  files["yarn.lock"] =
    '"widget@^1.0.0", widget@~1.2.0:\n  version "1.2.3"\n  resolved "https://registry.yarnpkg.com/widget/-/widget.tgz#' +
    "ab".repeat(20) +
    '"\n';
  expect(provenance.lockResolution(fake(files), "abc", "widget")[1]).toBe(
    "1.2.3",
  );
});
test("bootstrap preserves the reviewed ORAS/Syft checksums", () => {
  expect(TOOLS.oras[1]).toBe(
    "6cdc692f929100feb08aa8de584d02f7bcc30ec7d88bc2adc2054d782db57c64",
  );
  expect(TOOLS.syft[1]).toBe(
    "0e91737aee2b5baf1d255b959630194a302335d848ff97bb07921eb6205b5f5a",
  );
});

test("official package SHA-512 validation, nullable npm gitHead and no code execution", async () => {
  const vectors = require("./fixtures/python-parity.json");
  const fixture = vectors.find(
    (v) =>
      v.fn === "readTarball" &&
      !v.error &&
      v.expected?.["package.json"] &&
      Buffer.from(v.expected["package.json"].$buffer, "base64")
        .toString()
        .includes('"name":"next"'),
  );
  expect(fixture).toBeDefined();
  const archive = Buffer.from(fixture.args[0].$buffer, "base64");
  const publisher = new Publisher({
    SBOM_CATALOG_PUBLISH_REPOSITORY: "registry.example.com/catalog",
  });
  const metadata = {
    name: "next",
    version: "99.1.2",
    gitHead: null,
    dist: {
      integrity:
        "sha512-" +
        Buffer.from(sha(archive, "sha512"), "hex").toString("base64"),
      tarball: "https://registry.npmjs.org/next/-/next-99.1.2.tgz",
    },
  };
  publisher.download = jest
    .fn()
    .mockResolvedValueOnce(Buffer.from(JSON.stringify(metadata)))
    .mockResolvedValueOnce(archive);
  const [files, commit] = await publisher.officialPackage("99.1.2");
  expect(commit).toBeNull();
  expect(json(files["package.json"]).name).toBe("next");
  publisher.download = jest
    .fn()
    .mockResolvedValueOnce(Buffer.from(JSON.stringify(metadata)))
    .mockResolvedValueOnce(Buffer.from("corrupt"));
  await expect(publisher.officialPackage("99.1.2")).rejects.toThrow(
    "integrity",
  );
});
test("catalogue provenance fields must be strings and canonical base64", () => {
  for (const change of [
    (x) => (x.owner.sourceCommit = [x.owner.sourceCommit]),
    (x) => (x.owner.manifestSha256 = [x.owner.manifestSha256]),
    (x) => (x.owner.integrity = x.owner.integrity.replace(/=+$/, "")),
    (x) =>
      (x.components[0].evidence.commit = [x.components[0].evidence.commit]),
  ]) {
    const c = catalog();
    change(c);
    expect(() => schema.validateCatalog(c, "99.1.2")).toThrow();
  }
});
test("uncertain downstream POST is never retried", async () => {
  const transport = jest.fn(async () => {
    throw Error("timeout with secret");
  });
  await expect(client.trigger(["99.1.2"], ENV, transport)).rejects.toThrow();
  expect(transport).toHaveBeenCalledTimes(1);
});

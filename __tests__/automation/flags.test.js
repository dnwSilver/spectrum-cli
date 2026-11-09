const io = require("../../src/automation");
const { fs, path, temp, remove, save, read, sha } = io;
const { spawnSync } = require("node:child_process");
const { runAutomationAction } = require("../../src/cli/run-action");
const { reportPreflight } = require("../../src/cli/command-executor");
const nextjs = require("../../src/nextjs");
const sbom = require("../../src/sbom");
const { Publisher } = require("../../src/sbom/populate");
let dirs, log, error, previousCode;
beforeEach(() => {
  dirs = [];
  previousCode = process.exitCode;
  log = jest.spyOn(console, "log").mockImplementation(() => {});
  error = jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  dirs.forEach(remove);
  process.exitCode = previousCode;
  jest.restoreAllMocks();
});
function directory() {
  const dir = temp("cli-flags-test-");
  dirs.push(dir);
  return dir;
}
function put(root, file, text) {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, text);
}
function snapshot(root) {
  function walk(dir) {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))
      .flatMap((entry) => {
        const file = path.join(dir, entry.name);
        return entry.isDirectory()
          ? walk(file)
          : [[path.relative(root, file), sha(fs.readFileSync(file))]];
      });
  }
  return walk(root);
}
async function dry(action, extra = {}, silence = true) {
  await runAutomationAction((options) => action({ ...options, ...extra }), {
    opts: () => ({ dry: true, silence }),
  });
  expect(process.exitCode).toBe(0);
}
function licenseFixture(root) {
  const owner = '{"name":"next","version":"99.1.2"}';
  for (const prefix of ["", "dist/standalone/"]) {
    put(root, prefix + "node_modules/next/package.json", owner);
    put(
      root,
      prefix + "node_modules/next/dist/compiled/example/package.json",
      '{"name":"example"}',
    );
    put(
      root,
      prefix + "node_modules/next/dist/compiled/example/index.js",
      "module.exports=1;",
    );
  }
  put(
    root,
    "node_modules/next/dist/compiled/example/LICENSE",
    "Example license",
  );
}
test("licenses dry validates metadata and never copies LICENSE", async () => {
  const cwd = directory();
  licenseFixture(cwd);
  const before = snapshot(cwd);
  await dry(nextjs.licenses, { cwd });
  expect(snapshot(cwd)).toEqual(before);
  expect(
    fs.existsSync(
      path.join(
        cwd,
        "dist/standalone/node_modules/next/dist/compiled/example/LICENSE",
      ),
    ),
  ).toBe(false);
  expect(log.mock.calls.flat().join(" ")).not.toContain("Проверено");
});
test.each([[["--dry", "--silence"]], [["-ds"]]])(
  "real CLI parses %j without mutations",
  (args) => {
    const cwd = directory();
    licenseFixture(cwd);
    const before = snapshot(cwd);
    const result = spawnSync(
      process.execPath,
      [
        path.resolve(__dirname, "../../index.js"),
        "nextjs",
        "licenses",
        ...args,
      ],
      { cwd, encoding: "utf8", timeout: 10000 },
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Действия не выполнялись");
    expect(result.stdout).not.toContain("Проверено");
    expect(snapshot(cwd)).toEqual(before);
  },
);
test("resolve dry reads image descriptor but never scans with Syft, submits request or writes reports", async () => {
  const cwd = directory(),
    before = snapshot(cwd),
    run = jest.fn(() => JSON.stringify({ digest: "sha256:" + "1".repeat(64) })),
    trigger = jest.fn();
  await dry(sbom.resolve, {
    cwd,
    env: {
      SBOM_CATALOG_CLIENT_ENABLED: "true",
      SBOM_CATALOG_FRAMEWORK: "nextjs",
      SBOM_CATALOG_REPOSITORY: "registry.example.com/catalog",
      DOCKER_IMAGE: "registry.example.com/app",
      APP_VERSION: "1.2.3",
      SBOM_CATALOG_UPDATER_PROJECT: "automation/catalog",
      CI_JOB_TOKEN: "fake",
      CI_SERVER_URL: "https://gitlab.example.com",
      CI_API_V4_URL: "https://gitlab.example.com/api/v4",
    },
    deps: { bootstrap: async () => {}, run, trigger },
  });
  expect(run).toHaveBeenCalledTimes(1);
  expect(run.mock.calls[0][0]).toContain("--descriptor");
  expect(trigger).not.toHaveBeenCalled();
  expect(snapshot(cwd)).toEqual(before);
});
test("populate dry logs in and checks namespace without fetching upstream, building or publishing", async () => {
  const cwd = directory(),
    before = snapshot(cwd),
    publisher = new Publisher(
      {
        CI_COMMIT_BRANCH: "main",
        CI_COMMIT_REF_PROTECTED: "true",
        NEXT_CATALOG_VERSIONS: '["99.1.2"]',
        SBOM_CATALOG_PUBLISH_REPOSITORY: "registry.example.com/catalog",
        NEXUS_USER: "bot",
        NEXUS_PASSWORD: "fake",
      },
      { bootstrap: async () => {}, checkRegistryAccess: async () => ({}) },
    );
  publisher.oras = jest.fn();
  publisher.buildCatalog = jest.fn();
  publisher.publish = jest.fn();
  await dry((options) => publisher.main(options), { cwd });
  expect(publisher.oras).toHaveBeenCalledTimes(1);
  expect(publisher.oras.mock.calls[0][0][0]).toBe("login");
  expect(publisher.buildCatalog).not.toHaveBeenCalled();
  expect(publisher.publish).not.toHaveBeenCalled();
  expect(snapshot(cwd)).toEqual(before);
});

test("dry with silence still reports failed preflight and does not create outputs", async () => {
  const cwd = directory(),
    before = snapshot(cwd);
  await runAutomationAction(
    (options) =>
      sbom.resolve({
        ...options,
        cwd,
        env: {
          SBOM_CATALOG_CLIENT_ENABLED: "true",
          SBOM_CATALOG_FRAMEWORK: "nextjs",
          SBOM_CATALOG_REPOSITORY: "",
          DOCKER_IMAGE: "",
          APP_VERSION: "",
        },
      }),
    { opts: () => ({ dry: true, silence: true }) },
  );
  expect(process.exitCode).toBe(2);
  expect(error.mock.calls.flat().join(" ")).toContain(
    "Missing required variables",
  );
  expect(snapshot(cwd)).toEqual(before);
});
test('populate no-verify logs in and executes without protected-main or registry preflights', async () => {
  const cwd = directory();
  const checkRegistryAccess = jest.fn(() => { throw Error('preflight called'); });
  const publisher = new Publisher({ NEXT_CATALOG_VERSIONS: '["99.1.2"]',
    SBOM_CATALOG_PUBLISH_REPOSITORY: 'registry.example.com/catalog',
    NEXUS_USER: 'bot', NEXUS_PASSWORD: 'fake'
  }, { bootstrap: async () => {}, checkRegistryAccess });
  publisher.oras = jest.fn();
  publisher.descriptor = jest.fn(() => 'sha256:' + '1'.repeat(64));
  publisher.readback = jest.fn(() => ({ unresolved: [], components: [] }));
  await runAutomationAction(() => publisher.main({ cwd }), { verify: false });
  expect(process.exitCode).toBe(0);
  expect(checkRegistryAccess).not.toHaveBeenCalled();
  expect(publisher.oras.mock.calls[0][0][0]).toBe('login');
  expect(publisher.readback).toHaveBeenCalledTimes(1);
  expect(read(path.join(cwd, 'sbom-catalog-updater/report.json')).preflight).toBeUndefined();
});
test.each([
  "nextjs licenses",
  "sbom catalog resolve",
  "sbom catalog populate",
])("%s help lists short and long flags", (command) => {
  const result = spawnSync(
    process.execPath,
    [
      path.resolve(__dirname, "../../index.js"),
      ...command.split(" "),
      "--help",
    ],
    { encoding: "utf8", timeout: 10000 },
  );
  expect(result.status).toBe(0);
  expect(result.stdout).toContain("-d, --dry");
  expect(result.stdout).toContain("-s, --silence");
});


test("silence suppresses successful preflight messages while retaining errors", async () => {
  await runAutomationAction(async () => {
    reportPreflight("automation", "fixture");
    return 0;
  }, { opts: () => ({ silence: true }) });
  expect(log).not.toHaveBeenCalled();
  await runAutomationAction(async () => { throw Error("preflight denied"); },
    { opts: () => ({ silence: true }) });
  expect(error).toHaveBeenCalledWith("ERROR: preflight denied");
  expect(process.exitCode).toBe(1);
});

test.each(["scan", "track", "reconcile", "repair"])(
  "removed security %s is rejected by the real CLI without creating files",
  (command) => {
    const cwd = directory();
    const before = snapshot(cwd);
    const result = spawnSync(process.execPath,
      [path.resolve(__dirname, "../../index.js"), "security", command],
      { cwd, encoding: "utf8", timeout: 10000 });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("unknown command 'security'");
    expect(snapshot(cwd)).toEqual(before);
  },
);

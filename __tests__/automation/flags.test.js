const io = require("../../src/automation");
const { fs, path, temp, remove, save, read, sha } = io;
const { spawnSync } = require("node:child_process");
const { runAutomationAction } = require("../../src/cli/run-action");
const { reportPreflight } = require("../../src/cli/command-executor");
const { checkGitlabAccess } = require("../../src/preflight/automation");
const nextjs = require("../../src/nextjs");
const sbom = require("../../src/sbom");
const security = require("../../src/security");
const { Publisher } = require("../../src/sbom/populate");
const { Repairer } = require("../../src/security/repair");
const CFG = {
  project_id: "123",
  project_path: "example/webapp",
  branch: "main",
  sha: "a".repeat(40),
  pipeline_id: "456",
  pipeline_url: "https://gitlab.example.com/pipelines/456",
  youtrack_project: "APP",
  tester: "qa.user",
  time_article: "security",
  subsystem: "",
};
const FINDING = {
  id: "CVE-2099-12345",
  aliases: ["CVE-2099-12345"],
  severity: "HIGH",
  sources: ["npm"],
  occurrences: [{ package: "example-package" }],
  task: { key: "APP-1" },
  parent: { key: "CVE-1" },
};
const ENV = {
  PATH: process.env.PATH,
  NEXUS_USER: "",
  NEXUS_PASSWORD: "",
  CI_REGISTRY_USER: "",
  CI_REGISTRY_PASSWORD: "",
  CI_PROJECT_ID: "123",
  CI_PROJECT_PATH: "example/webapp",
  CI_COMMIT_SHA: CFG.sha,
  CI_PIPELINE_ID: "456",
  CI_PIPELINE_URL: CFG.pipeline_url,
  CI_JOB_ID: "789",
  NIGHTLY_YOUTRACK_PROJECT: "APP",
  NIGHTLY_YOUTRACK_TIME_TRACKING_ARTICLE: "security",
  NIGHTLY_YOUTRACK_TESTER: "qa.user",
};
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
test("scan dry checks source/tools/registry without npm audit, Trivy scan or report files", async () => {
  const cwd = directory();
  put(cwd, "Dockerfile", "FROM registry.example.com/runtime:24.1.0\n");
  const before = snapshot(cwd);
  const run = jest.fn(() => ({
    stdout: "sha256:" + "1".repeat(64),
    status: 0,
  }));
  const checkExecutables = jest.fn();
  const registry = { immutableImage: jest.fn(async () => "image@sha256:" + "1".repeat(64)) };
  await dry(security.scan, {
    cwd,
    env: {
      ...ENV,
      NIGHTLY_NPM_ENABLED: "false",
      NIGHTLY_CHECK_NODE: "false",
      NIGHTLY_DOCKERFILE: "Dockerfile",
    },
    deps: { run, checkExecutables, registry },
  });
  expect(run).not.toHaveBeenCalled();
  expect(registry.immutableImage).toHaveBeenCalledWith("registry.example.com/runtime:24.1.0");
  expect(checkExecutables.mock.calls[0][0]).toEqual(["trivy"]);
  expect(snapshot(cwd)).toEqual(before);
});
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
test("track dry validates trusted consumer and YouTrack without creating issues or tracked artifact", async () => {
  const cwd = directory();
  put(cwd, "security-report/tracked.json", "previous result");
  const before = snapshot(cwd);
  const tracker = { ensure: jest.fn() },
    api = {
      post: jest.fn(),
      get: jest.fn(async (location) => {
        if (location.endsWith("/jobs/10")) return { pipeline: { id: "456" } };
        if (location.includes("/pipelines/"))
          return { source: "schedule", ref: "main", sha: CFG.sha, id: "456" };
        if (location.includes("/artifacts/"))
          return Buffer.from(
            JSON.stringify({
              schemaVersion: 1,
              config: CFG,
              findings: [FINDING],
              errors: [],
            }),
          );
        return { protected: true };
      }),
    };
  await dry(security.track, {
    cwd,
    env: {
      YOUTRACK_URL: "https://issues.example.com",
      YOUTRACK_PRIVATE_TOKEN: "fake",
      NIGHTLY_CONSUMER_PROJECT: "123",
      NIGHTLY_CONSUMER_SCAN_JOB: "10",
      NIGHTLY_EXPECTED_COMPONENT_SHA: CFG.sha,
      CI_COMMIT_SHA: CFG.sha,
    },
    deps: {
      api,
      tracker,
      checkGitlabAccess: async () => ({}),
      checkYouTrackAccess: async () => ({}),
    },
  });
  expect(tracker.ensure).not.toHaveBeenCalled();
  expect(api.post).not.toHaveBeenCalled();
  expect(snapshot(cwd)).toEqual(before);
});
test("reconcile dry checks component reference but never creates pipeline or overwrites tracked artifact", async () => {
  const cwd = directory();
  save(path.join(cwd, "security-report/findings.json"), {
    schemaVersion: 1,
    config: CFG,
    findings: [FINDING],
    errors: [],
  });
  put(cwd, "security-report/tracked.json", "previous result");
  const before = snapshot(cwd),
    api = { post: jest.fn(), get: jest.fn(async () => ({ id: CFG.sha })) };
  await dry(security.reconcile, {
    cwd,
    env: {
      NIGHTLY_TRACKER_PROJECT: "automation/security",
      NIGHTLY_COMPONENT_SHA: CFG.sha,
      NIGHTLY_TRACKER_REF: "v2.0.0",
      NIGHTLY_SCAN_JOB_ID: "10",
      CI_PROJECT_ID: "123",
    },
    deps: { api, checkGitlabAccess: async () => ({}) },
  });
  expect(api.post).not.toHaveBeenCalled();
  expect(snapshot(cwd)).toEqual(before);
});
test("repair dry checks tasks and source SHA without cloning, modifying dependencies, checks, commits or MRs", async () => {
  const cwd = directory();
  save(path.join(cwd, "security-report/tracked.json"), {
    config: CFG,
    findings: [FINDING],
    errors: [],
  });
  put(cwd, "security-report/final.json", "previous result");
  put(cwd, "security-report/message.json", "previous messages");
  put(cwd, "package.json", "{}");
  put(cwd, "package-lock.json", "{}");
  const before = snapshot(cwd);
  const api = {
      post: jest.fn(),
      get: jest.fn(async () => ({ commit: { id: CFG.sha } })),
    },
    run = jest.fn(() => ({ status: 0, stdout: "" }));
  const repairOne = jest.spyOn(Repairer.prototype, "repairOne");
  await dry(security.repair, {
    cwd,
    env: { ...ENV, NIGHTLY_CHECK_COMMANDS: '[["npm","test"]]' },
    deps: {
      api,
      run,
      checkExecutables: () => {},
      checkGitlabAccess: async () => ({}),
    },
  });
  expect(repairOne).not.toHaveBeenCalled();
  expect(api.post).not.toHaveBeenCalled();
  expect(run.mock.calls.map(([args]) => args.slice(0, 2))).toEqual([
    ["git", "cat-file"],
  ]);
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
test("silence suppresses successful service preflight messages while retaining errors", async () => {
  const env = {
      CI_API_V4_URL: "https://gitlab.example.com/api/v4",
      GLAB_BOT_PAT: "fake",
    },
    api = {
      get: async (location) =>
        location === "user"
          ? { id: 1, state: "active" }
          : location === "personal_access_tokens/self"
            ? { active: true, scopes: ["api"] }
            : { permissions: { project_access: { access_level: 40 } } },
    };
  await runAutomationAction(
    async () => {
      await checkGitlabAccess(env, ["123"], { api });
      return 0;
    },
    { opts: () => ({ silence: true }) },
  );
  expect(log).not.toHaveBeenCalled();
  await runAutomationAction(
    async () => {
      throw Error("preflight denied");
    },
    { opts: () => ({ silence: true }) },
  );
  expect(error).toHaveBeenCalledWith("ERROR: preflight denied");
  expect(process.exitCode).toBe(1);
});

test('track no-verify reads its report and creates tasks without access or pipeline preflights', async () => {
  const cwd = directory();
  const checkGitlabAccess = jest.fn(() => { throw Error('preflight called'); });
  const checkYouTrackAccess = jest.fn(() => { throw Error('preflight called'); });
  const tracker = { ensure: jest.fn(async () => ({ task: { key: 'APP-1' }, parent: { key: 'CVE-1' } })) };
  const api = { get: jest.fn(async () => Buffer.from(JSON.stringify({
    schemaVersion: 1, config: CFG, findings: [FINDING], errors: []
  }))) };
  await runAutomationAction(() => security.track({
    cwd,
    env: { YOUTRACK_URL: 'https://issues.example.com', YOUTRACK_PRIVATE_TOKEN: 'fake',
      NIGHTLY_CONSUMER_PROJECT: '123', NIGHTLY_CONSUMER_SCAN_JOB: '10' },
    deps: { api, tracker, checkGitlabAccess, checkYouTrackAccess }
  }), { verify: false });
  expect(process.exitCode).toBe(0);
  expect(checkGitlabAccess).not.toHaveBeenCalled();
  expect(checkYouTrackAccess).not.toHaveBeenCalled();
  expect(api.get).toHaveBeenCalledTimes(1);
  expect(api.get.mock.calls[0][0]).toContain('/artifacts/');
  expect(tracker.ensure).toHaveBeenCalledTimes(1);
  expect(read(path.join(cwd, 'security-report/tracked.json')).preflight).toBeUndefined();
});

test('reconcile no-verify starts the tracker without introspection or ref verification', async () => {
  const cwd = directory();
  const report = { config: CFG, findings: [FINDING], errors: [] };
  save(path.join(cwd, 'security-report/findings.json'), report);
  const checkGitlabAccess = jest.fn(() => { throw Error('preflight called'); });
  const api = {
    post: jest.fn(async () => ({ id: 1, sha: CFG.sha, status: 'success' })),
    get: jest.fn(async (location) => location.includes('/artifacts/')
      ? Buffer.from(JSON.stringify(report)) : [{ id: 2, name: 'nightly:track' }])
  };
  await runAutomationAction(() => security.reconcile({ cwd,
    env: { NIGHTLY_TRACKER_PROJECT: 'automation/security', NIGHTLY_COMPONENT_SHA: CFG.sha,
      NIGHTLY_TRACKER_REF: 'v2.0.0', NIGHTLY_SCAN_JOB_ID: '10', CI_PROJECT_ID: '123' },
    deps: { api, checkGitlabAccess }
  }), { verify: false });
  expect(process.exitCode).toBe(0);
  expect(checkGitlabAccess).not.toHaveBeenCalled();
  expect(api.post).toHaveBeenCalledTimes(1);
  expect(api.get.mock.calls.every(([location]) => !location.includes('/repository/'))).toBe(true);
  expect(read(path.join(cwd, 'security-report/tracked.json'))).toEqual(report);
});

test('repair no-verify enters repairOne without an access preflight', async () => {
  const cwd = directory();
  save(path.join(cwd, 'security-report/tracked.json'), { config: CFG, findings: [FINDING], errors: [] });
  const checkGitlabAccess = jest.fn(() => { throw Error('preflight called'); });
  const repairOne = jest.spyOn(Repairer.prototype, 'repairOne').mockResolvedValue({ status: 'verified' });
  await runAutomationAction(() => security.repair({ cwd, env: ENV,
    deps: { api: {}, checkGitlabAccess }
  }), { verify: false });
  expect(process.exitCode).toBe(0);
  expect(checkGitlabAccess).not.toHaveBeenCalled();
  expect(repairOne).toHaveBeenCalledTimes(1);
  expect(read(path.join(cwd, 'security-report/final.json')).preflight).toBeUndefined();
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
  "security scan",
  "security track",
  "security reconcile",
  "security repair",
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

test.each(["reconcile", "repair"])(
  "%s dry reports incomplete evidence even with no findings, preserving files",
  async (phase) => {
    const cwd = directory(),
      file = phase === "repair" ? "tracked.json" : "findings.json";
    save(path.join(cwd, "security-report", file), {
      config: CFG,
      findings: [],
      errors: ["scan failed"],
    });
    const before = snapshot(cwd);
    await runAutomationAction(
      (options) => security[phase]({ ...options, cwd, env: ENV }),
      { opts: () => ({ dry: true, silence: true }) },
    );
    expect(process.exitCode).toBe(1);
    expect(error.mock.calls.flat().join(" ")).toContain("Incomplete scan");
    expect(snapshot(cwd)).toEqual(before);
  },
);

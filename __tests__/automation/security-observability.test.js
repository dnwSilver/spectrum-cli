const { path, temp, remove, save, read } = require("../../src/automation");
const { reconcile, track } = require("../../src/security/tracking");
const { Repairer } = require("../../src/security/repair");
const { runAutomationAction } = require("../../src/cli/run-action");
const CVE = "CVE-2099-12345";
const config = {
  project_id: "123",
  project_path: "example/app",
  sha: "a".repeat(40),
  branch: "master",
  youtrack_project: "APP",
  time_article: "security",
  tester: "qa",
  pipeline_id: "456",
  pipeline_url: "https://gitlab.example/pipelines/456",
};
const finding = {
  id: CVE,
  severity: "HIGH",
  aliases: [CVE],
  sources: ["npm"],
  occurrences: [],
};
const env = {
  CI_API_V4_URL: "https://gitlab.example/api/v4",
  CI_PROJECT_ID: "123",
  NIGHTLY_TRACKER_PROJECT: "shared/security",
  NIGHTLY_COMPONENT_SHA: "a".repeat(40),
  NIGHTLY_SCAN_JOB_ID: "789",
};
let root, stderr, previousExit;
beforeEach(() => {
  root = temp("nightly-log-");
  stderr = jest.spyOn(console, "error").mockImplementation(() => {});
  previousExit = process.exitCode;
});
afterEach(() => {
  remove(root);
  process.exitCode = previousExit;
  jest.restoreAllMocks();
});
const report = (errors = [], findings = [finding]) => ({
  schemaVersion: 1,
  config,
  findings: structuredClone(findings),
  errors,
});
const logs = () => stderr.mock.calls.flat().join("\n");
test("missing GitLab token is visible in reconcile job log even with silence", async () => {
  save(path.join(root, "security-report/findings.json"), report());
  await runAutomationAction(
    (options) => reconcile({ ...options, cwd: root, env }),
    { opts: () => ({ silence: true }) },
  );
  expect(process.exitCode).toBe(1);
  expect(logs()).toContain("ERROR security reconcile:");
  expect(logs()).toContain("GLAB_BOT_PAT");
  expect(
    read(path.join(root, "security-report/tracked.json")).errors.join(" "),
  ).toContain("GLAB_BOT_PAT");
});
test("repair names the upstream tracking failure and never attempts an unsafe fix", async () => {
  save(
    path.join(root, "security-report/tracked.json"),
    report(["GitLab API and GLAB_BOT_PAT are required"]),
  );
  const repairer = new Repairer(env);
  repairer.repairOne = jest.fn();
  expect(await repairer.repair(root)).toBe(1);
  expect(repairer.repairOne).not.toHaveBeenCalled();
  expect(logs()).toContain("ERROR security repair:");
  expect(logs()).toContain("Incomplete scan/tracking");
  expect(logs()).toContain("GLAB_BOT_PAT");
  expect(
    read(path.join(root, "security-report/final.json")).findings[0].repair
      .reason,
  ).toContain("GLAB_BOT_PAT");
});
test("empty incomplete reports still print the failure before early return", async () => {
  save(
    path.join(root, "security-report/findings.json"),
    report(["registry unavailable"], []),
  );
  expect(await reconcile({ cwd: root, env })).toBe(1);
  expect(logs()).toContain("registry unavailable");
  stderr.mockClear();
  expect(await new Repairer(env).repair(root)).toBe(1);
  expect(logs()).toContain("registry unavailable");
});
test("repair errors identify the advisory and redact all available token values", async () => {
  const item = { ...finding, task: { key: "APP-1" }, parent: { key: "CVE-1" } };
  save(path.join(root, "security-report/tracked.json"), report([], [item]));
  const repairer = new Repairer(
    { ...env, GITLAB_PRIVATE_TOKEN: "private-secret" },
    { api: {}, checkGitlabAccess: async () => ({}) },
  );
  repairer.repairOne = jest.fn(async () => {
    throw new Error("dependency check failed private-secret");
  });
  expect(await repairer.repair(root)).toBe(1);
  expect(logs()).toContain("ERROR security repair [" + CVE + "]");
  expect(logs()).toContain("dependency check failed [REDACTED]");
  expect(logs()).not.toContain("private-secret");
  expect(
    JSON.stringify(read(path.join(root, "security-report/final.json"))),
  ).not.toContain("private-secret");
});
test("central tracker preflight errors are printed before returning failure", async () => {
  const current = report();
  const api = {
    get: async (location) =>
      location.includes("/artifacts/")
        ? Buffer.from(JSON.stringify(current))
        : location.endsWith("/jobs/789")
          ? { pipeline: { id: "456" } }
          : location.includes("/pipelines/")
            ? { source: "schedule", ref: "master", sha: config.sha, id: "456" }
            : { protected: true },
  };
  expect(
    await track({
      cwd: root,
      env: {
        ...env,
        YOUTRACK_URL: "https://issues.example",
        YOUTRACK_PRIVATE_TOKEN: "fake",
        NIGHTLY_EXPECTED_COMPONENT_SHA: config.sha,
        CI_COMMIT_SHA: config.sha,
        NIGHTLY_CONSUMER_PROJECT: "123",
        NIGHTLY_CONSUMER_SCAN_JOB: "789",
      },
      deps: {
        api,
        checkGitlabAccess: async () => ({}),
        checkYouTrackAccess: async () => {
          throw new Error("required YouTrack field unavailable");
        },
      },
    }),
  ).toBe(1);
  expect(logs()).toContain(
    "ERROR security track: required YouTrack field unavailable",
  );
});

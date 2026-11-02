const { path, temp, remove, read, sha, stable } = require("../../src/automation");
const { Tracker } = require("../../src/security/tracker");
const { track, queueTracking } = require("../../src/security/tracking");
const { stateMarker } = require("../../src/security/repair-plan");
const { projectText } = require("../../src/security/task-text");
let root;
beforeEach(() => { root = temp("repair-links-"); });
afterEach(() => remove(root));
const cfg = { project_id: "123", project_path: "example/app", branch: "master", sha: "a".repeat(40), pipeline_id: "456", scan_job_id: "789", pipeline_url: "https://gl.example/pipelines/456", youtrack_project: "APP" };
const value = { id: "CVE-2099-12345", aliases: ["CVE-2099-12345"], sources: ["npm"], severity: "HIGH", occurrences: [{ package: "example-package", entry: "example-package" }], task: { id: "1", key: "APP-1" } };
test("the same MR link is written once and survives later task Markdown regeneration", async () => {
  const issue = { id: "1", idReadable: "APP-1", project: { shortName: "APP" }, description: projectText(value, cfg, "HIGH") };
  const api = {
    get: jest.fn(async () => structuredClone(issue)),
    post: jest.fn(async (_, body) => { Object.assign(issue, body); }),
  };
  const tracker = new Tracker(api, "https://yt.example", {});
  const mr = { web_url: "https://gl.example/mr/7" };
  await tracker.linkMR(value, cfg, mr);
  await tracker.linkMR(value, cfg, mr);
  expect(api.post).toHaveBeenCalledTimes(1);
  expect(projectText(value, cfg, "HIGH", issue.description)).toContain(mr.web_url);
});
test("MR link writer rejects a task from a different YouTrack project", async () => {
  const api = { get: jest.fn(async () => ({ ...value.task, project: { shortName: "OTHER" } })), post: jest.fn() };
  await expect(new Tracker(api, "https://yt.example", {}).linkMR(value, cfg, { web_url: "https://gl.example/mr/7" })).rejects.toThrow("different YouTrack project");
  expect(api.post).not.toHaveBeenCalled();
});
function worker(overrides = {}) {
  const keys = ["npm:example-package"], id = sha(stable(keys)).slice(0, 16);
  const state = { schema: 1, id, keys, base: cfg.sha, scan: cfg.sha, head: "b".repeat(40), files: {}, cves: [value.id] };
  const mr = { iid: 7, state: "opened", source_project_id: 123, target_branch: cfg.branch, source_branch: "hotfix/APP-1-security-" + id, sha: state.head, web_url: "https://gl.example/mr/7", description: stateMarker(state), ...overrides };
  const env = { CI_COMMIT_SHA: "c".repeat(40), NIGHTLY_EXPECTED_COMPONENT_SHA: "c".repeat(40), NIGHTLY_CONSUMER_PROJECT: "123", NIGHTLY_CONSUMER_SCAN_JOB: "789", NIGHTLY_REPAIR_MR: "7", YOUTRACK_URL: "https://yt.example", YOUTRACK_PRIVATE_TOKEN: "fake-token" };
  const api = { get: jest.fn(async (location) => {
    if (location.includes("/artifacts/")) return Buffer.from(JSON.stringify({ schemaVersion: 1, config: cfg, findings: [value], errors: [] }));
    if (location.endsWith("/jobs/789")) return { pipeline: { id: 456 } };
    if (location.endsWith("/pipelines/456")) return { id: 456, source: "schedule", ref: cfg.branch, sha: cfg.sha };
    if (location.includes("/repository/branches/")) return { protected: true };
    if (location.endsWith("/merge_requests/7")) return mr;
    throw Error("unexpected GET " + location);
  }) };
  const tracker = { ensure: jest.fn(async () => ({ task: value.task, parent: { key: "CVE-1" } })), linkMR: jest.fn() };
  return { env, api, tracker, mr, state, deps: { api, tracker, checkGitlabAccess: async () => ({}), checkYouTrackAccess: async () => ({}) } };
}
test("central worker resolves project tasks from trusted scan evidence and writes grouped MR links", async () => {
  const w = worker();
  expect(await track({ env: w.env, cwd: root, deps: w.deps })).toBe(0);
  expect(w.tracker.ensure).toHaveBeenCalledTimes(1);
  expect(w.tracker.ensure).toHaveBeenCalledWith(expect.objectContaining({ id: value.id }), cfg, { readOnly: true });
  expect(w.tracker.linkMR).toHaveBeenCalledWith(expect.objectContaining({ id: value.id, task: value.task }), cfg, w.mr);
  expect(read(path.join(root, "security-report/tracked.json")).errors).toEqual([]);
});
test.each([{ source_project_id: 999 }, { target_branch: "dev" }, { sha: "d".repeat(40) }, { source_branch: "feature/unrelated" }])("unrelated or changed MRs never update YouTrack: %j", async (override) => {
  const w = worker(override);
  expect(await track({ env: w.env, cwd: root, deps: w.deps })).toBe(1);
  expect(read(path.join(root, "security-report/tracked.json")).errors.join(" ")).toContain("MR identity");
  expect(w.tracker.linkMR).not.toHaveBeenCalled();
  expect(w.tracker.ensure).not.toHaveBeenCalled();
});

test("MR link publication uses the serialized tracker and forwards only the MR IID plus frozen identity", async () => {
  const report = { config: cfg, findings: [value], errors: [] };
  const env = { CI_PROJECT_ID: "123", NIGHTLY_TRACKER_PROJECT: "shared/security", NIGHTLY_COMPONENT_SHA: "c".repeat(40), NIGHTLY_COMPONENT_REFERENCE: "main", NIGHTLY_SCAN_JOB_ID: "789" };
  const api = {
    get: jest.fn(async (location) => {
      if (location.includes("/repository/commits/")) return { id: env.NIGHTLY_COMPONENT_SHA };
      if (location.endsWith("/jobs")) return [{ name: "nightly:track", id: 9 }];
      if (location.includes("/artifacts/")) return Buffer.from(JSON.stringify(report));
      throw Error("unexpected GET " + location);
    }),
    post: jest.fn(async () => ({ id: 100, status: "success", sha: env.NIGHTLY_COMPONENT_SHA })),
  };
  await queueTracking(report, env, { api, checkGitlabAccess: async () => ({}) }, { repairMR: 7 });
  expect(api.post).toHaveBeenCalledWith("projects/shared%2Fsecurity/pipeline", { ref: "main", inputs: {
    operation: "nightly-track", consumer_project: "123", consumer_scan_job: "789", component_sha: env.NIGHTLY_COMPONENT_SHA, repair_mr: "7",
  } });
});

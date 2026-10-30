const { cliIdentity, verifyCLI } = require("../automation/tooling");
const {
  path,
  ensure,
  read,
  json,
  save,
  COMMIT,
  sleep,
  equal,
} = require("../automation");
const { encoded } = require("../sbom/schema");
const {
  glab,
  projectPath,
  pages,
  API,
  diagnostic,
  logPhaseErrors,
} = require("./runtime");
const { HIGH } = require("./findings");
const { Tracker } = require("./tracker");
const {
  isDryRun,
  isVerificationSkipped,
  reportPreflight,
} = require("../cli/command-executor");
const {
  required,
  httpsEndpoint,
  checkGitlabAccess,
  checkYouTrackAccess,
} = require("../preflight/automation");
async function track({
  env = process.env,
  cwd = process.cwd(),
  deps = {},
  dry = isDryRun(),
} = {}) {
  if (!isVerificationSkipped())
    ensure(
      env.NIGHTLY_EXPECTED_COMPONENT_SHA &&
        env.NIGHTLY_EXPECTED_COMPONENT_SHA === env.CI_COMMIT_SHA,
      "Tracker must run the same commit as the included component",
    );
  required(env, [
    "YOUTRACK_URL",
    "YOUTRACK_PRIVATE_TOKEN",
    "NIGHTLY_CONSUMER_PROJECT",
    "NIGHTLY_CONSUMER_SCAN_JOB",
  ]);
  httpsEndpoint(env.YOUTRACK_URL, "YOUTRACK_URL");
  const api = deps.api || glab(env);
  if (!isVerificationSkipped())
    await (deps.checkGitlabAccess || checkGitlabAccess)(
      env,
      [env.NIGHTLY_CONSUMER_PROJECT],
      { api },
    );
  const consumer = projectPath(env.NIGHTLY_CONSUMER_PROJECT),
    jobId = env.NIGHTLY_CONSUMER_SCAN_JOB;
  ensure(/^\d+(?![\s\S])/.test(jobId || ""), "Invalid consumer job ID");
  const report = json(
      await api.get(
        consumer +
          "/jobs/" +
          jobId +
          "/artifacts/security-report/findings.json",
        { raw: true },
      ),
    ),
    cfg = report.config;
  if (!isVerificationSkipped())
    ensure(
      report.schemaVersion === 1 &&
        String(cfg.project_id) === env.NIGHTLY_CONSUMER_PROJECT,
      "Consumer report identity mismatch",
    );
  if (!isVerificationSkipped()) {
    const job = await api.get(consumer + "/jobs/" + jobId);
    const pipeline = await api.get(consumer + "/pipelines/" + job.pipeline.id);
    ensure(
      pipeline.source === "schedule" &&
        pipeline.ref === cfg.branch &&
        pipeline.sha === cfg.sha &&
        String(pipeline.id) === String(cfg.pipeline_id),
      "Tracking is restricted to matching scheduled branch pipelines",
    );
    const branch = await api.get(
      consumer + "/repository/branches/" + encoded(cfg.branch),
    );
    ensure(
      branch.protected,
      "Nightly automation requires a protected production branch",
    );
  }
  verifyCLI(report, env);
  const base = httpsEndpoint(env.YOUTRACK_URL, "YOUTRACK_URL");
  const youtrack = new API(base + "/api", {
    Authorization: "Bearer " + env.YOUTRACK_PRIVATE_TOKEN,
  });
  const tracker = deps.tracker || new Tracker(youtrack, base, env);
  try {
    if (!isVerificationSkipped())
      report.preflight = {
        youtrack: await (deps.checkYouTrackAccess || checkYouTrackAccess)(
          env,
          cfg,
          youtrack,
        ),
      };
  } catch (error) {
    if (dry) throw error;
    report.errors.push(diagnostic(error.message, env));
    save(path.join(cwd, "security-report/tracked.json"), report);
    logPhaseErrors("security track", report, env);
    return 1;
  }
  if (dry) {
    ensure(!report.errors.length, "Incomplete scan evidence blocks tracking");
    reportPreflight(
      "security track",
      "consumer-identity",
      "проверены scheduled pipeline, protected branch и источник отчёта",
    );
    return 0;
  }
  for (const value of report.findings) {
    try {
      ensure(HIGH.has(value.severity), "Unexpected finding severity");
      Object.assign(value, await tracker.ensure(value, cfg));
    } catch (error) {
      value.tracking_error = diagnostic(error.message, env);
      report.errors.push(value.id + ": " + diagnostic(error.message, env));
    }
  }
  save(path.join(cwd, "security-report/tracked.json"), report);
  logPhaseErrors("security track", report, env);
  return report.errors.length ? 1 : 0;
}
async function reconcile({
  env = process.env,
  cwd = process.cwd(),
  deps = {},
  dry = isDryRun(),
} = {}) {
  const file = path.join(cwd, "security-report"),
    reportFile = path.join(file, "tracked.json");
  let report = read(path.join(file, "findings.json"));
  if (dry)
    ensure(!report.errors.length, "Incomplete scan evidence blocks tracking");
  try {
    verifyCLI(report, env);
    if (!report.findings.length) return report.errors.length ? 1 : 0;
    required(env, [
      "NIGHTLY_TRACKER_PROJECT",
      "NIGHTLY_COMPONENT_SHA",
      "NIGHTLY_SCAN_JOB_ID",
      "CI_PROJECT_ID",
    ]);
    const api = deps.api || glab(env);
    if (!isVerificationSkipped())
      report.preflight = {
        gitlab: await (deps.checkGitlabAccess || checkGitlabAccess)(
          env,
          [env.NIGHTLY_TRACKER_PROJECT],
          { api, write: true, purpose: "pipeline" },
        ),
      };
    const target = projectPath(env.NIGHTLY_TRACKER_PROJECT),
      sha = env.NIGHTLY_COMPONENT_SHA;
    ensure(COMMIT.test(sha), "Invalid component SHA");
    let ref = env.NIGHTLY_TRACKER_REF;
    const reference = env.NIGHTLY_COMPONENT_REFERENCE;
    if (!ref && reference && reference !== "~latest" && !/^v?\d+(?:\.\d+){0,2}$/.test(reference) && !COMMIT.test(reference))
      ref = reference;
    if (!ref) {
      const refs = await pages(
          api,
          target + "/repository/commits/" + sha + "/refs",
          { type: "tag" },
        ),
        names = refs
          .map((item) => item.name)
          .filter((name) => /^v\d+\.\d+\.\d+(?![\s\S])/.test(name))
          .sort();
      ensure(
        names.length,
        "Release the component or explicitly configure tracker_ref for a pilot",
      );
      ref = names.at(-1);
    }
    if (!isVerificationSkipped()) {
      const commit = await api.get(
        target + "/repository/commits/" + encoded(ref),
      );
      ensure(
        commit.id === sha,
        "Tracker reference does not match the included component",
      );
    }
    reportPreflight(
      "security reconcile",
      "tracker-reference",
      "ref очереди соответствует SHA компонента",
    );
    if (dry) return report.errors.length ? 1 : 0;
    let pipeline = await api.post(target + "/pipeline", {
      ref,
      inputs: {
        operation: "nightly-track",
        consumer_project: env.CI_PROJECT_ID,
        consumer_scan_job: env.NIGHTLY_SCAN_JOB_ID,
        component_sha: sha,
        ...(cliIdentity(env) ? { cli_identity: JSON.stringify(cliIdentity(env)) } : {}),
      },
    });
    ensure(
      pipeline.sha === sha,
      "Tracker ref changed while creating its pipeline",
    );
    const deadline = Date.now() + 1200000;
    while (
      !["success", "failed", "canceled", "skipped"].includes(pipeline.status)
    ) {
      ensure(Date.now() < deadline, "Timed out waiting for the YouTrack queue");
      console.log("Waiting for serialized YouTrack tracking");
      await (deps.sleep || sleep)(10000);
      pipeline = await api.get(target + "/pipelines/" + pipeline.id);
    }
    const jobs = await pages(
        api,
        target + "/pipelines/" + pipeline.id + "/jobs",
      ),
      matches = jobs.filter((job) => job.name === "nightly:track");
    ensure(matches.length === 1, "Tracker job missing or ambiguous");
    const tracked = json(
      await api.get(
        target +
          "/jobs/" +
          matches[0].id +
          "/artifacts/security-report/tracked.json",
        { raw: true },
      ),
    );
    ensure(
      equal(tracked.config, report.config),
      "Tracker result identity mismatch",
    );
    ensure(!report.cli || equal(tracked.cli, report.cli), "Tracker result CLI identity mismatch");
    verifyCLI(tracked, env);
    report = tracked;
    ensure(
      pipeline.status === "success",
      "YouTrack tracking completed with errors",
    );
  } catch (error) {
    if (dry) throw error;
    report.errors.push(diagnostic(error.message, env));
  } finally {
    if (!dry) {
      save(reportFile, report);
      logPhaseErrors("security reconcile", report, env);
    }
  }
  return report.errors.length ? 1 : 0;
}
module.exports = { track, reconcile };

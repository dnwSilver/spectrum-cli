const io = require("../../src/automation");
const { fs, path, temp, remove, save, read, exec } = io;
const f = require("../../src/security/findings");
const {
  API,
  cleanEnv,
  run,
  registryAuth,
} = require("../../src/security/runtime");
const { Scanner, runtimeFromDockerfile } = require("../../src/security/scan");
const { Tracker } = require("../../src/security/tracker");
const { Repairer } = require("../../src/security/repair");
const { track, reconcile } = require("../../src/security/tracking");
const { formatReport, messageParts } = require("../../src/security/report");
const CVE = "CVE-2099-12345",
  GHSA = "GHSA-aaaa-bbbb-cccc";
const CFG = {
  project_id: "123",
  project_path: "example/webapp",
  sha: "a".repeat(40),
  branch: "master",
  youtrack_project: "APP",
  subsystem: "webapp",
  time_article: "security-team",
  tester: "test.qa",
  pipeline_id: "456",
  pipeline_url: "https://gitlab.example/example/webapp/-/pipelines/456",
};
const value = (source = "npm") =>
  f.finding([CVE], "HIGH", source, {
    package: "test-package",
    entry: "test-package",
    fix: false,
  });
let directories;
beforeEach(() => {
  directories = [];
});
afterEach(() => {
  directories.forEach(remove);
});
const dir = () => {
  const d = temp("spectrum-security-test-");
  directories.push(d);
  return d;
};
class TrackerAPI {
  constructor() {
    this.issues = [];
    this.links = {};
    this.calls = [];
    this.failLinkOnce = false;
    this.ignoredFields = new Set();
  }
  async get(location, { query } = {}) {
    if (location === "admin/projects")
      return [{ id: query.query, shortName: query.query }];
    if (location === "issues") {
      const project = query.query.split("{")[1].split("}")[0];
      return structuredClone(
        this.issues
          .filter((issue) => issue.project.shortName === project)
          .slice(Number(query.$skip), Number(query.$skip) + Number(query.$top)),
      );
    }
    if (/^issues\/[^/]+$/.test(location))
      return structuredClone(
        this.issues.find((issue) => issue.id === location.split("/")[1]),
      );
    if (location.endsWith("/links"))
      return [
        {
          id: "link",
          direction: "OUTWARD",
          linkType: { sourceToTarget: "parent for" },
        },
      ];
    if (location.includes("/links/"))
      return structuredClone(
        this.issues
          .filter((issue) => this.links[location.split("/")[1]]?.has(issue.id))
          .slice(Number(query.$skip), Number(query.$skip) + Number(query.$top)),
      );
    throw Error(location);
  }
  async request(method, location, data) {
    this.calls.push([method, location, structuredClone(data)]);
    const number = this.issues.length + 1,
      project = data.project.id;
    const issue = {
      id: String(number),
      idReadable: project + "-" + number,
      project: { shortName: project },
      summary: data.summary,
      description: data.description,
      customFields: (data.customFields || []).filter(
        (field) => !this.ignoredFields.has(field.name),
      ),
      resolved: null,
    };
    this.issues.push(structuredClone(issue));
    return structuredClone(issue);
  }
  async post(location, data) {
    this.calls.push(["POST", location, structuredClone(data)]);
    if (location.includes("/links/")) {
      if (this.failLinkOnce) {
        this.failLinkOnce = false;
        throw Error("simulated link timeout");
      }
      const parent = location.split("/")[1];
      this.links[parent] ||= new Set();
      this.links[parent].add(data.id);
    } else if (/^issues\/[^/]+$/.test(location)) {
      const issue = this.issues.find(
        (issue) => issue.id === location.split("/")[1],
      );
      const fields = new Map(
        issue.customFields.map((field) => [field.name, field]),
      );
      for (const field of data.customFields || [])
        if (!this.ignoredFields.has(field.name))
          fields.set(field.name, structuredClone(field));
      issue.customFields = [...fields.values()];
    }
    return {};
  }
}
test("npm audit reports HIGH leaf advisories, not wrappers, and resolves aliases", async () => {
  const report = {
    vulnerabilities: {
      wrapper: {
        via: [
          "other",
          {
            name: "leaf",
            severity: "high",
            source: 42,
            url: "https://github.com/advisories/" + GHSA,
          },
          { severity: "moderate", source: 43 },
        ],
      },
    },
  };
  const result = await f.npmFindings(report, async (key) => [key, CVE]);
  expect(result).toHaveLength(1);
  expect(result[0]).toMatchObject({
    id: CVE,
    severity: "HIGH",
    occurrences: [{ package: "leaf" }],
  });
});
test.each([
  { error: { code: "ENETUNREACH" } },
  { vulnerabilities: {}, error: { code: "EAUDIT" } },
  {},
])("npm error is not clean: %j", async (report) => {
  await expect(f.npmFindings(report)).rejects.toThrow("valid report");
});
test("alias bridge merges sources and preserves Critical", () => {
  const result = f.mergeFindings([
    f.finding([GHSA], "HIGH", "npm", { package: "a" }),
    f.finding([CVE], "CRITICAL", "runtime", { package: "b" }),
    f.finding([CVE, GHSA], "HIGH", "node", { package: "node" }),
  ]);
  expect(result).toHaveLength(1);
  expect(result[0]).toMatchObject({
    severity: "CRITICAL",
    sources: ["node", "npm", "runtime"],
  });
  expect(result[0].occurrences).toHaveLength(3);
});
test("Trivy reports unfixed HIGH/CRITICAL and rejects invalid schema", () => {
  expect(
    f.trivyFindings({
      SchemaVersion: 2,
      Results: [
        {
          Target: "Debian",
          Vulnerabilities: [
            {
              VulnerabilityID: CVE,
              Severity: "HIGH",
              PkgName: "openssl",
              FixedVersion: "",
            },
          ],
        },
      ],
    })[0].id,
  ).toBe(CVE);
  expect(() => f.trivyFindings({})).toThrow("Invalid Trivy");
});
test("final stage resolves global arguments and aliases", () => {
  expect(
    runtimeFromDockerfile(
      "ARG BASE=registry.example/runtime:24.1.0.1\nFROM ${BASE} AS base\nFROM node:24 AS build\nFROM base\n",
    ),
  ).toBe("registry.example/runtime:24.1.0.1");
  for (const text of ["FROM ${UNKNOWN}", "FROM scratch", "# no FROM"])
    expect(() => runtimeFromDockerfile(text)).toThrow();
});
test.each(["HIGH", "CRITICAL"])(
  "parent required fields, reuse and separate repository child: %s",
  async (severity) => {
    const api = new TrackerAPI(),
      tracker = new Tracker(api, "https://yt.example", {}),
      item = { ...value(), severity };
    const first = await tracker.ensure(item, CFG);
    expect(await tracker.ensure(item, CFG)).toEqual(first);
    expect(api.issues).toHaveLength(2);
    const fields = Object.fromEntries(
      api.issues[0].customFields.map((field) => [field.name, field.value]),
    );
    expect(fields).toEqual({
      "CVE ID": CVE,
      Severity: { name: severity === "HIGH" ? "High" : "Critical" },
      Priority: { name: severity === "HIGH" ? "Critical" : "Stopper" },
      Type: { name: "Group" },
    });
    expect(api.issues[1].customFields).toEqual([]);
    await tracker.ensure(item, {
      ...CFG,
      project_id: "124",
      project_path: "example/admin-app",
    });
    expect(api.issues).toHaveLength(3);
  },
);
test("required parent fields must persist before creating child; retry repairs same issue", async () => {
  const api = new TrackerAPI(),
    tracker = new Tracker(api, "https://yt.example", {});
  api.ignoredFields.add("Priority");
  await expect(tracker.ensure(value(), CFG)).rejects.toThrow(
    "persist required",
  );
  expect(api.issues).toHaveLength(1);
  api.ignoredFields.clear();
  await tracker.ensure(value(), CFG);
  expect(api.issues).toHaveLength(2);
});
test("severity escalates, existing Critical stays Critical, enum metadata is preserved", async () => {
  const api = new TrackerAPI(),
    tracker = new Tracker(api, "https://yt.example", {});
  await tracker.ensure(value(), CFG);
  await tracker.ensure({ ...value(), severity: "CRITICAL" }, CFG);
  api.issues[0].customFields
    .filter((field) => typeof field.value === "object")
    .forEach((field) =>
      Object.assign(field.value, { id: "enum", $type: "EnumBundleElement" }),
    );
  const writes = api.calls.filter(
    ([, location]) => location === "issues/1",
  ).length;
  await tracker.ensure(value(), CFG);
  expect(
    api.calls.filter(([, location]) => location === "issues/1"),
  ).toHaveLength(writes);
  expect(
    api.issues[0].customFields.find((field) => field.name === "Priority").value
      .name,
  ).toBe("Stopper");
});
test("legacy bot parent repaired, manual parent and child adopted without metadata rewrite", async () => {
  const api = new TrackerAPI();
  const parent = await api.request("POST", "issues", {
    project: { id: "CVE" },
    summary: "[" + CVE + "]",
    description: "manual",
  });
  const child = await api.request("POST", "issues", {
    project: { id: "APP" },
    summary: "[" + CVE + "] Устранение в проекте webapp",
    description: "manual",
  });
  api.links[parent.id] = new Set([child.id]);
  const tracker = new Tracker(api, "https://yt.example", {});
  expect((await tracker.ensure(value(), CFG)).task.id).toBe(child.id);
  expect(api.issues).toHaveLength(2);
  expect(api.calls.some(([, p]) => p === "issues/1")).toBe(false);
  api.issues[0].description = "<!-- nightly-security parent -->";
  await tracker.ensure(value(), CFG);
  expect(api.issues[0].customFields).toHaveLength(4);
});
test("orphan child survives link timeout; resolved task reopens", async () => {
  const api = new TrackerAPI(),
    tracker = new Tracker(api, "https://yt.example", {});
  api.failLinkOnce = true;
  await expect(tracker.ensure(value(), CFG)).rejects.toThrow("timeout");
  expect(api.issues).toHaveLength(2);
  api.issues[1].resolved = 123;
  await tracker.ensure(value(), CFG);
  expect(api.issues).toHaveLength(2);
  expect(api.calls.some(([, , body]) => body.query === "State {Новая}")).toBe(
    true,
  );
  expect(
    api.calls.some(
      ([, , body]) =>
        body.query ===
        "Статья учета времени {security-team} Tester {test.qa} Subsystem {webapp}",
    ),
  ).toBe(true);
});
test("ambiguous parents and injected field commands block writes", async () => {
  const api = new TrackerAPI(),
    tracker = new Tracker(api, "https://yt.example", {});
  await expect(
    tracker.ensure(value(), { ...CFG, tester: "user} State Done" }),
  ).rejects.toThrow("braces");
  expect(api.issues).toHaveLength(0);
  for (let i = 0; i < 2; i++)
    await api.request("POST", "issues", {
      project: { id: "CVE" },
      summary: "[" + CVE + "]",
      description: "",
    });
  await expect(tracker.ensure(value(), CFG)).rejects.toThrow("Multiple parent");
  expect(api.issues).toHaveLength(2);
});
test("existing MR and moved production never mutate", async () => {
  const repairer = new Repairer({});
  const item = { ...value(), task: { key: "APP-1" } },
    api = {
      get: jest.fn(async (location) =>
        location.endsWith("/merge_requests")
          ? [{ web_url: "https://gl/mr/1" }]
          : null,
      ),
      post: jest.fn(),
    };
  expect(
    (await repairer.repairOne(api, item, { config: CFG }, "/unused")).status,
  ).toBe("existing");
  expect(api.post).not.toHaveBeenCalled();
  api.get.mockImplementation(async (location) =>
    location.endsWith("/merge_requests") ||
    location.endsWith("/repository/branches")
      ? []
      : { commit: { id: "b".repeat(40) } },
  );
  await expect(
    repairer.repairOne(api, item, { config: CFG }, "/unused"),
  ).rejects.toThrow("moved after scan");
  expect(api.post).not.toHaveBeenCalled();
});
test("build commands receive no automation credentials and never log subprocess contents", () => {
  expect(
    cleanEnv({
      GLAB_BOT_PAT: "a",
      YOUTRACK_PRIVATE_TOKEN: "b",
      MATTERMOST_HOOK_ERRORS: "c",
      CI_JOB_JWT: "d",
      PATH: "/bin",
    }),
  ).toEqual({ PATH: "/bin" });
  expect(() =>
    exec([process.execPath, "-e", 'console.error("secret"); process.exit(1)']),
  ).toThrow("failed (exit 1)");
});
test("isolated registry auth is removed even on failure", async () => {
  let auth;
  await expect(
    registryAuth(
      {
        NEXUS_USER: "writer",
        NEXUS_PASSWORD: "secret",
        NIGHTLY_REGISTRY_HOSTS: "registry.example.com",
      },
      async (env) => {
        auth = env.REGISTRY_AUTH_FILE;
        expect(fs.statSync(auth).mode & 0o777).toBe(0o600);
        throw Error("stop");
      },
    ),
  ).rejects.toThrow("stop");
  expect(fs.existsSync(auth)).toBe(false);
});
test("actual Node vulnerability ranges are evaluated without invoking project code", () => {
  const feed = {
    1: {
      vulnerable: "24.x || 22.x",
      patched: ">=24.22.1 <25 || >=22.23.4 <23",
      severity: "high",
      cve: [CVE],
      affectedEnvironments: ["linux"],
    },
  };
  expect(f.nodeFindings("24.21.0", feed)[0].id).toBe(CVE);
  for (const version of ["24.22.1", "22.23.4", "26.0.0"])
    expect(f.nodeFindings(version, feed)).toEqual([]);
  feed[1].cve = [];
  expect(f.nodeFindings("24.21.0", feed)[0].id).toBe("NSWG-COR-1");
});
test("writes are not retried and artifact redirects lose API credentials", async () => {
  const transport = jest.fn(async () => ({
    status: 503,
    headers: new Headers(),
    body: Buffer.from("secret"),
  }));
  const api = new API(
    "https://gitlab.invalid",
    { "PRIVATE-TOKEN": "test" },
    transport,
    async () => {},
  );
  await expect(api.post("projects/1/merge_requests", {})).rejects.toThrow(
    "HTTP 503",
  );
  expect(transport).toHaveBeenCalledTimes(1);
  transport
    .mockReset()
    .mockResolvedValueOnce({
      status: 302,
      headers: new Headers({
        location: "https://storage.invalid/signed?secret=1",
      }),
      body: Buffer.alloc(0),
    })
    .mockResolvedValueOnce({
      status: 200,
      headers: new Headers(),
      body: Buffer.from("artifact"),
    });
  expect(await api.get("artifact", { raw: true })).toEqual(
    Buffer.from("artifact"),
  );
  expect(transport.mock.calls[1][1].headers).toEqual({
    "User-Agent": "nightly-security",
  });
});
test("empty findings skip queue and still write tracked artifact", async () => {
  const root = dir();
  save(path.join(root, "security-report/findings.json"), {
    config: CFG,
    findings: [],
    errors: [],
  });
  const api = { get: jest.fn() };
  expect(await reconcile({ cwd: root, env: {}, deps: { api } })).toBe(0);
  expect(api.get).not.toHaveBeenCalled();
  expect(
    read(path.join(root, "security-report/tracked.json")).findings,
  ).toEqual([]);
});
test("tracking rejects wrong source, identity or unprotected branch before YouTrack writes", async () => {
  const root = dir(),
    report = { schemaVersion: 1, config: CFG, findings: [value()], errors: [] };
  const env = {
    YOUTRACK_URL: "https://issues.example.com",
    YOUTRACK_PRIVATE_TOKEN: "fake-test-token",
    NIGHTLY_EXPECTED_COMPONENT_SHA: "x",
    CI_COMMIT_SHA: "x",
    NIGHTLY_CONSUMER_PROJECT: "123",
    NIGHTLY_CONSUMER_SCAN_JOB: "10",
  };
  const tracker = { ensure: jest.fn() };
  let source = "push",
    protectedBranch = false;
  const api = {
    get: async (location) =>
      location.endsWith("/jobs/10")
        ? { pipeline: { id: "456" } }
        : location.includes("/pipelines/")
          ? { source, ref: CFG.branch, sha: CFG.sha, id: CFG.pipeline_id }
          : location.includes("/artifacts/")
            ? Buffer.from(JSON.stringify(report))
            : { protected: protectedBranch },
  };
  await expect(
    track({
      cwd: root,
      env,
      deps: {
        api,
        tracker,
        checkGitlabAccess: async () => ({}),
        checkYouTrackAccess: async () => ({}),
      },
    }),
  ).rejects.toThrow("scheduled");
  source = "schedule";
  await expect(
    track({
      cwd: root,
      env,
      deps: {
        api,
        tracker,
        checkGitlabAccess: async () => ({}),
        checkYouTrackAccess: async () => ({}),
      },
    }),
  ).rejects.toThrow("protected");
  expect(tracker.ensure).not.toHaveBeenCalled();
  protectedBranch = true;
  tracker.ensure.mockResolvedValue({
    parent: { key: "CVE-1" },
    task: { key: "APP-1" },
  });
  expect(
    await track({
      cwd: root,
      env,
      deps: {
        api,
        tracker,
        checkGitlabAccess: async () => ({}),
        checkYouTrackAccess: async () => ({}),
      },
    }),
  ).toBe(0);
  expect(
    read(path.join(root, "security-report/tracked.json")).findings[0].task.key,
  ).toBe("APP-1");
});
test("Mattermost report preserves links, incomplete status and message size", () => {
  const item = {
    ...value(),
    parent: { key: "CVE-1", url: "https://yt/CVE-1" },
    task: { key: "APP-1", url: "https://yt/APP-1" },
    repair: { status: "created", mr: "https://gl/mr/1" },
  };
  const text = formatReport({ config: CFG, findings: [item], errors: [] });
  expect(text).toContain("ожидает проверок CI");
  expect(text).not.toContain("проверки пройдены");
  for (const link of [
    "https://yt/CVE-1",
    "https://yt/APP-1",
    "https://gl/mr/1",
  ])
    expect(text).toContain(link);
  expect(
    formatReport({ config: CFG, findings: [], errors: ["network"] }),
  ).not.toContain("не обнаружены");
  expect(
    messageParts("a".repeat(6000) + "\n\n" + "b".repeat(6000)),
  ).toHaveLength(2);
});
test.each(["npm", "runtime"])("%s Draft MR is prepared without install/build/checks; orphan commit is recovered without duplicate or checkout changes", async (source) => {
  const root = dir();
  exec(["git", "init", "-q", root]);
  fs.writeFileSync(
    path.join(root, "package.json"),
    '{"dependencies":{"test-package":"1.0.0"}}\n',
  );
  fs.writeFileSync(path.join(root, "package-lock.json"), '{"fixed":false}\n');
  fs.writeFileSync(path.join(root, "Dockerfile"), "FROM registry.example/runtime:24.1.0.1\n");
  exec(["git", "add", "."], { cwd: root });
  exec(
    [
      "git",
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.invalid",
      "-c",
      "core.hooksPath=/dev/null",
      "commit",
      "-qm",
      "fixture",
    ],
    { cwd: root },
  );
  const sha = exec(["git", "rev-parse", "HEAD"], { cwd: root }).stdout.trim(),
    cfg = { ...CFG, sha },
    item = {
      ...value(source),
      task: { key: "APP-1", url: "https://yt/APP-1" },
      parent: { key: "CVE-1", url: "https://yt/CVE-1" },
    },
    report = { config: cfg, findings: [item], errors: [], runtime: { image: "registry.example/runtime:24.1.0.1@sha256:" + "1".repeat(64), dockerfile: "Dockerfile", platforms: ["linux/amd64"], "linux/amd64": { node: "24.1.0" } } };
  let actions,
    lostMR = false;
  const posts = [];
  const api = {
    get: async (location) => {
      if (location.endsWith("/merge_requests")) return [];
      if (location.endsWith("/repository/branches"))
        return actions
          ? [
              {
                name: "hotfix/APP-1-security",
                commit: {
                  id: "b".repeat(40),
                  parent_ids: [sha],
                  message: `fix(APP-1): remediate ${CVE} [skip ci]`,
                },
              },
            ]
          : [];
      if (location.endsWith("/diff"))
        return actions.map((action) => ({ new_path: action.file_path }));
      if (location.includes("/repository/files/")) {
        const filename = decodeURIComponent(
            location.split("/files/")[1].slice(0, -4),
          ),
          action = actions.find((action) => action.file_path === filename);
        return Buffer.from(
          action.content,
          action.encoding === "base64" ? "base64" : "utf8",
        );
      }
      return { commit: { id: sha } };
    },
    post: async (location, body) => {
      posts.push([location, structuredClone(body)]);
      if (location.endsWith("/repository/commits")) {
        actions = body.actions;
        return { id: "b".repeat(40) };
      }
      if (lostMR) {
        lostMR = false;
        throw Error("simulated MR response timeout");
      }
      return { web_url: "https://gl/mr/1" };
    },
  };
  const env = {
      ...process.env,
      NIGHTLY_NPM_ENABLED: "true",
      NIGHTLY_CHECK_COMMANDS: JSON.stringify([
        [process.execPath, "-e", "process.exit(1)"],
      ]),
    },
    repairer = new Repairer(env);
  const commands = [];
  repairer.run = (args, cwd, options) => {
    commands.push(args);
    if (args[0] === "npm") {
      if (args[1] === "update")
        fs.writeFileSync(
          path.join(cwd, "package-lock.json"),
          '{"fixed":true}\n',
        );
      return { status: 0, stdout: "", stderr: "" };
    }
    return run(args, cwd, options);
  };
  repairer.auditNpm = async (work) => [
    {},
    source === "runtime" || read(path.join(work, "package-lock.json")).fixed ? [] : [value()],
  ];
  repairer.imageCandidates = async () => ["registry.example/runtime:24.2.0.1"];
  repairer.immutableImage = async (image) => image + "@sha256:" + "2".repeat(64);
  repairer.scanImage = jest.fn(async () => [{}, [], "24.2.0"]);
  lostMR = true;
  await expect(repairer.repairOne(api, item, report, root)).rejects.toThrow(
    "timeout",
  );
  expect((await repairer.repairOne(api, item, report, root)).status).toBe(
    "created",
  );
  expect(commands.every((args) => args[0] === "git" || (args[0] === "npm" && args[1] === "update"))).toBe(true);
  const mr = posts.find(([location]) => location.endsWith("/merge_requests"))[1];
  expect(mr.title).toMatch(/^Draft:/);
  expect(mr.description).toContain("в nightly не запускались");
  expect(mr.description).not.toContain("Проверки проекта и повторный аудит выполнены");
  const commits = posts.filter(([location]) =>
    location.endsWith("/repository/commits"),
  );
  expect(commits).toHaveLength(1);
  expect(commits[0][1].start_sha).toBe(sha);
  expect(actions.map((action) => action.file_path).sort()).toEqual([
    ".changelog/APP-1.security.md",
    source === "npm" ? "package-lock.json" : "Dockerfile",
  ]);
  expect(read(path.join(root, "package-lock.json")).fixed).toBe(false);
});
test("unsafe runtime candidates never replace Dockerfile and safe same-major one is verified", async () => {
  const root = dir();
  fs.writeFileSync(
    path.join(root, "Dockerfile"),
    "FROM registry.example/runtime:24.1.0.1\n",
  );
  const report = {
      runtime: {
        image: "registry.example/runtime:24.1.0.1@sha256:" + "1".repeat(64),
        dockerfile: "Dockerfile",
        platforms: ["linux/amd64"],
      },
      findings: [value("runtime")],
    },
    repairer = new Repairer({});
  repairer.imageCandidates = () => ["candidate"];
  repairer.immutableImage = () => "candidate@sha256:" + "2".repeat(64);
  for (const entries of [
    [value("runtime")],
    [f.finding(["CVE-2099-99999"], "HIGH", "runtime", { package: "new" })],
  ]) {
    repairer.scanImage = async () => [{}, entries, "24.2.0"];
    await expect(
      repairer.fixRuntime(root, value("runtime"), report),
    ).rejects.toThrow("safe runtime");
  }
  repairer.scanImage = async () => [{}, [], "25.0.0"];
  report.runtime["linux/amd64"] = { node: "24.1.0" };
  await expect(
    repairer.fixRuntime(root, value("runtime"), report),
  ).rejects.toThrow("safe runtime");
  repairer.scanImage = async () => [{}, [], "24.2.0"];
  await repairer.fixRuntime(root, value("runtime"), report);
  expect(fs.readFileSync(path.join(root, "Dockerfile"), "utf8")).toContain(
    "candidate@sha256:",
  );
});

test.each([true, false])("runtime owner keeps publication label synchronized with verified candidates (existing label: %s)", async (existing) => {
  const root = dir();
  const dockerfile = path.join(root, "Dockerfile");
  fs.writeFileSync(dockerfile, "FROM registry.example/runtime:24.1.0.1\n" +
    (existing ? 'LABEL com.google.distroless.nodejs.version="24.1.0"\n' : "") + 'CMD ["--version"]\n');
  fs.writeFileSync(path.join(root, ".gitlab-ci.yml"), 'variables:\n  RUNTIME_IMAGE_TAG: "24.1.0.1"\n');
  const repairer = new Repairer({ NIGHTLY_RUNTIME_PUBLISH_VARIABLE: "RUNTIME_IMAGE_TAG" });
  repairer.imageCandidates = async () => ["registry.example/runtime:24.2.0"];
  repairer.immutableImage = async () => "registry.example/runtime:24.2.0@sha256:" + "2".repeat(64);
  repairer.scanImage = async () => [{}, [], "24.2.0"];
  const report = { runtime: { image: "old", dockerfile: "Dockerfile", platforms: ["linux/amd64", "linux/arm64"] }, findings: [value("runtime")] };
  await repairer.fixRuntime(root, value("runtime"), report);
  const source = fs.readFileSync(dockerfile, "utf8");
  expect(source.match(/LABEL /g)).toHaveLength(1);
  expect(source).toContain('LABEL com.google.distroless.nodejs.version="24.2.0"');
  expect(source).not.toContain('="24.1.0"');
  expect(fs.readFileSync(path.join(root, ".gitlab-ci.yml"), "utf8")).toContain('RUNTIME_IMAGE_TAG: "24.2.0.2"');
});
test.each(["different platform versions", "unsupported label layout"])("runtime owner leaves files unchanged for %s", async (problem) => {
  const root = dir();
  const dockerfile = path.join(root, "Dockerfile"), pipeline = path.join(root, ".gitlab-ci.yml");
  const source = 'FROM registry.example/runtime:24.1.0.1\n' + (problem === "unsupported label layout" ?
    'LABEL other="value" com.google.distroless.nodejs.version="24.1.0"\n' : "");
  const ci = 'variables:\n  RUNTIME_IMAGE_TAG: "24.1.0.1"\n';
  fs.writeFileSync(dockerfile, source);
  fs.writeFileSync(pipeline, ci);
  const repairer = new Repairer({ NIGHTLY_RUNTIME_PUBLISH_VARIABLE: "RUNTIME_IMAGE_TAG" });
  repairer.imageCandidates = async () => ["candidate"];
  repairer.immutableImage = async () => "candidate@sha256:" + "2".repeat(64);
  repairer.scanImage = async (_, platform) => [{}, [], problem === "different platform versions" && platform === "linux/arm64" ? "24.3.0" : "24.2.0"];
  const report = { runtime: { image: "old", dockerfile: "Dockerfile", platforms: ["linux/amd64", "linux/arm64"] }, findings: [value("runtime")] };
  await expect(repairer.fixRuntime(root, value("runtime"), report)).rejects.toThrow(
    problem === "different platform versions" ? "platform versions differ" : "dedicated LABEL");
  expect(fs.readFileSync(dockerfile, "utf8")).toBe(source);
  expect(fs.readFileSync(pipeline, "utf8")).toBe(ci);
});
test("full-match migration rejects terminal newlines in IDs, versions and digests", () => {
  const { SEMVER, DIGEST, COMMIT } = require("../../src/automation");
  expect(SEMVER.test("1.2.3\n")).toBe(false);
  expect(DIGEST.test("sha256:" + "a".repeat(64) + "\n")).toBe(false);
  expect(COMMIT.test("a".repeat(40) + "\n")).toBe(false);
  expect(() => f.canonical([CVE + "\n"])).toThrow("stable");
});

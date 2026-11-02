const io = require("../../src/automation");
const { fs, path, temp, remove, save, read, exec, sha, stable } = io;
const { Repairer } = require("../../src/security/repair");
const { planRepairs, groupState } = require("../../src/security/repair-plan");
const { run } = require("../../src/security/runtime");
jest.setTimeout(30000);
const finding = (n, source = "npm") => ({
  id: `CVE-2099-${12340 + n}`, aliases: [`CVE-2099-${12340 + n}`], sources: [source], severity: "HIGH",
  occurrences: [source === "npm" ? { package: "protobufjs", entry: "protobufjs", nodes: ["node_modules/centrifuge/node_modules/protobufjs"], fix: { name: "centrifuge", version: "5.0.0", isSemVerMajor: true } } : { package: "openssl", installed: "1.0.0", fixed: "2.0.0" }],
  task: { id: String(n), key: "APP-" + n, url: "https://yt.example/issue/APP-" + n },
  parent: { key: "CVE-" + n, url: "https://yt.example/issue/CVE-" + n },
});
let roots;
beforeEach(() => { roots = []; });
afterEach(() => roots.forEach(remove));
function fixture(findings = [finding(1), finding(2)]) {
  const root = temp("group-repair-"); roots.push(root);
  exec(["git", "init", "-q", root]);
  save(path.join(root, "package.json"), { dependencies: { centrifuge: "2.0.0", other: "1.0.0" } });
  save(path.join(root, "package-lock.json"), { packages: {
    "node_modules/centrifuge": { version: "2.0.0", dependencies: { protobufjs: "^6" } },
    "node_modules/centrifuge/node_modules/protobufjs": { version: "6.0.0" },
    "node_modules/other": { version: "1.0.0" },
  } });
  fs.writeFileSync(path.join(root, "Dockerfile"), "FROM registry.example/runtime:24.1.0.1\n");
  exec(["git", "add", "."], { cwd: root });
  exec(["git", "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", "commit", "-qm", "fixture"], { cwd: root });
  const base = exec(["git", "rev-parse", "HEAD"], { cwd: root }).stdout.trim();
  const cfg = { project_id: "123", project_path: "example/app", branch: "master", sha: base, pipeline_id: "456", scan_job_id: "789", pipeline_url: "https://gl.example/pipelines/456" };
  const report = { schemaVersion: 1, config: cfg, findings, errors: [], runtime: { image: "registry.example/runtime:24.1.0.1@sha256:" + "a".repeat(64), dockerfile: "Dockerfile", platforms: ["linux/amd64"], "linux/amd64": { node: "24.1.0" } } };
  const initial = Object.fromEntries(["package.json", "package-lock.json", "Dockerfile"].map((name) => [name, fs.readFileSync(path.join(root, name))]));
  const commits = new Map([[base, { tree: initial, files: Object.fromEntries(Object.keys(initial).map((name) => [name, base])), id: base, parent_ids: [] }]]);
  const branches = new Map([["master", commits.get(base)]]), mrs = [], calls = [];
  let serial = 0;
  const api = {
    calls, mrs, commits, branches, failCommitResponse: false, failMRResponse: false,
    get: jest.fn(async (location, { query = {} } = {}) => {
      if (/\/merge_requests\/\d+$/.test(location)) return structuredClone(mrs.find((mr) => mr.iid === Number(location.split("/").at(-1))));
      if (location.endsWith("/merge_requests")) return mrs.filter((mr) => (!query.source_branch || mr.source_branch === query.source_branch) && (!query.search || mr.description.includes(query.search))).map((mr) => structuredClone(mr));
      if (location.endsWith("/repository/branches")) return [...branches].filter(([name]) => !query.search || new RegExp(query.search).test(name)).map(([name, commit]) => ({ name, commit }));
      if (location.includes("/repository/branches/")) return { commit: branches.get(decodeURIComponent(location.split("/branches/")[1])) };
      if (location.endsWith("/diff")) return commits.get(location.split("/commits/")[1].slice(0, -5)).diff;
      if (location.includes("/repository/files/")) {
        const raw = location.endsWith("/raw");
        const name = decodeURIComponent(location.split("/files/")[1].replace(/\/raw$/, ""));
        const commit = commits.get(query.ref);
        return raw ? commit.tree[name] : { last_commit_id: commit.files[name] };
      }
      throw Error("unexpected GET " + location);
    }),
    post: jest.fn(async (location, body) => {
      calls.push(["POST", location, structuredClone(body)]);
      if (location.endsWith("/repository/commits")) {
        expect(body).not.toHaveProperty("force");
        expect(body.commit_message).not.toMatch(/\[(skip ci|ci skip)\]/i);
        const parent = branches.get(body.branch) || commits.get(body.start_sha);
        const id = sha(String(++serial) + stable(body)).slice(0, 40);
        const tree = { ...parent.tree }, files = { ...parent.files };
        for (const action of body.actions) {
          if (action.last_commit_id) expect(action.last_commit_id).toBe(parent.files[action.file_path]);
          tree[action.file_path] = Buffer.from(action.content, action.encoding === "base64" ? "base64" : "utf8");
          files[action.file_path] = id;
        }
        const commit = { id, parent_ids: [parent.id], message: body.commit_message, tree, files, diff: body.actions.map((action) => ({ new_path: action.file_path })) };
        commits.set(id, commit); branches.set(body.branch, commit);
        if (api.failCommitResponse) { api.failCommitResponse = false; throw Error("commit response timeout"); }
        return commit;
      }
      if (location.endsWith("/merge_requests")) {
        const mr = { ...body, iid: mrs.length + 1, web_url: "https://gl.example/mr/" + (mrs.length + 1) };
        mrs.push(mr);
        if (api.failMRResponse) { api.failMRResponse = false; throw Error("MR response timeout"); }
        return structuredClone(mr);
      }
      throw Error("unexpected POST " + location);
    }),
    request: jest.fn(async (method, location, body) => {
      calls.push([method, location, structuredClone(body)]);
      expect(method).toBe("PUT");
      const mr = mrs.find((item) => item.iid === Number(location.split("/").at(-1)));
      Object.assign(mr, body); return structuredClone(mr);
    }),
  };
  const publishedLinks = jest.fn(async () => ({ errors: [] }));
  const repairer = new Repairer({}, { api, checkGitlabAccess: async () => ({}), publishRepairLinks: publishedLinks });
  const commands = [];
  repairer.run = (args, cwd, options) => {
    commands.push(args);
    if (args[0] !== "npm") return run(args, cwd, options);
    expect(args).toEqual(expect.arrayContaining(["--package-lock-only", "--ignore-scripts", "--no-audit"]));
    expect(args).not.toContain("--force");
    if (args[1] === "install") {
      const manifest = read(path.join(cwd, "package.json"));
      manifest.dependencies.centrifuge = args.at(-1).split("@").at(-1);
      save(path.join(cwd, "package.json"), manifest);
      const lock = read(path.join(cwd, "package-lock.json"));
      lock.packages["node_modules/centrifuge"].version = manifest.dependencies.centrifuge;
      save(path.join(cwd, "package-lock.json"), lock);
    }
    return { status: 0, stdout: "", stderr: "" };
  };
  repairer.auditNpm = jest.fn(async (cwd) => [{}, read(path.join(cwd, "package.json")).dependencies.centrifuge === repairer.requiredVersion ? [] : report.findings.filter((item) => item.sources.includes("npm"))]);
  repairer.requiredVersion = "5.0.0";
  repairer.imageCandidates = async () => ["registry.example/runtime:24.2.0.1"];
  repairer.immutableImage = async (image) => image + "@sha256:" + "b".repeat(64);
  repairer.scanImage = jest.fn(async () => [{}, [], "24.2.0"]);
  const execute = async () => {
    save(path.join(root, "security-report/tracked.json"), report);
    const status = await repairer.repair(root);
    Object.assign(report, read(path.join(root, "security-report/final.json")));
    return status;
  };
  return { root, api, report, repairer, publishedLinks, commands, execute, base };
}

test("several CVEs fixed by one direct dependency produce one MR, one update, and shared report links", async () => {
  const f = fixture();
  expect(await f.execute()).toBe(0);
  expect(f.api.mrs).toHaveLength(1);
  expect(f.commands.filter((args) => args[0] === "npm" && args[1] === "install")).toHaveLength(1);
  expect(f.api.calls.filter(([, url]) => url.endsWith("/repository/commits"))).toHaveLength(1);
  for (const value of f.report.findings) {
    expect(value.repair.mr).toBe(f.api.mrs[0].web_url);
    expect(f.api.mrs[0].description).toContain(value.task.url);
    expect(f.api.mrs[0].description).toContain(value.id);
  }
  expect(f.publishedLinks).toHaveBeenCalledTimes(1);
  expect(f.api.mrs[0].description).toContain("Мажорные обновления");
  expect(read(path.join(f.root, "package.json")).dependencies.centrifuge).toBe("2.0.0");
  expect([...f.api.branches.keys()].filter((name) => name.startsWith("hotfix/"))).toHaveLength(1);
});
test("the next nightly reuses the same MR without a new commit", async () => {
  const f = fixture();
  expect(await f.execute()).toBe(0);
  const commits = f.api.commits.size;
  expect(await f.execute()).toBe(0);
  expect(f.api.commits.size).toBe(commits);
  expect(f.api.mrs).toHaveLength(1);
  expect(f.report.findings[0].repair.status).toBe("existing");
});
test("a newer suggested version appends a checked commit to the existing bot MR without force", async () => {
  const f = fixture();
  expect(await f.execute()).toBe(0);
  const mr = f.api.mrs[0], previous = groupState(mr.description).head;
  f.repairer.requiredVersion = "6.0.0";
  f.report.findings.forEach((value) => { value.occurrences[0].fix.version = "6.0.0"; });
  expect(await f.execute()).toBe(0);
  expect(f.api.mrs).toHaveLength(1);
  const head = groupState(mr.description).head;
  expect(head).not.toBe(previous);
  expect(f.api.commits.get(head).parent_ids).toEqual([previous]);
  expect(f.report.findings[0].repair.status).toBe("updated");
  expect(f.api.calls.flat().join(" ")).not.toContain("cancel");
});
test.each(["failCommitResponse", "failMRResponse"])("retry after %s does not duplicate the commit or MR", async (mode) => {
  const f = fixture(); f.api[mode] = true;
  expect(await f.execute()).toBe(1);
  expect(await f.execute()).toBe(0);
  expect(f.api.mrs).toHaveLength(1);
  expect(f.api.calls.filter(([, url]) => url.endsWith("/repository/commits"))).toHaveLength(1);
});
test("manual changes to a source branch block automatic writes and remain intact", async () => {
  const f = fixture(); expect(await f.execute()).toBe(0);
  const mr = f.api.mrs[0], previous = f.api.branches.get(mr.source_branch);
  const human = { ...previous, id: "d".repeat(40), parent_ids: [previous.id], message: "human change" };
  f.api.branches.set(mr.source_branch, human); f.api.commits.set(human.id, human);
  const count = f.api.calls.length;
  expect(await f.execute()).toBe(1);
  expect(f.api.calls).toHaveLength(count);
  expect(f.api.branches.get(mr.source_branch).id).toBe(human.id);
});
test("runtime and npm findings make separate repair groups and MRs", async () => {
  const f = fixture([finding(1), finding(2, "runtime"), finding(3, "node")]);
  expect(planRepairs(f.report.findings, f.root, f.report.runtime)).toHaveLength(2);
  expect(await f.execute()).toBe(0);
  expect(f.api.mrs).toHaveLength(2);
  expect(f.report.findings[1].repair.mr).toBe(f.report.findings[2].repair.mr);
  expect(f.report.findings[0].repair.mr).not.toBe(f.report.findings[1].repair.mr);
});
test("a hoisted transitive dependency is grouped with its actual direct owners", () => {
  const f = fixture();
  const lock = read(path.join(f.root, "package-lock.json"));
  delete lock.packages["node_modules/centrifuge/node_modules/protobufjs"];
  lock.packages["node_modules/protobufjs"] = { version: "6.0.0" };
  lock.packages["node_modules/other"].dependencies = { protobufjs: "^6" };
  save(path.join(f.root, "package-lock.json"), lock);
  const value = finding(1); value.occurrences[0].fix = true; value.occurrences[0].nodes = ["node_modules/protobufjs"];
  expect(planRepairs([value], f.root)[0].group.keys).toEqual(["npm:centrifuge", "npm:other"]);
});

test("different suggested versions for one direct dependency are resolved once to the highest target", async () => {
  const f = fixture();
  f.report.findings[1].occurrences[0].fix.version = "6.0.0";
  f.repairer.requiredVersion = "6.0.0";
  expect(await f.execute()).toBe(0);
  expect(f.commands.filter((args) => args[0] === "npm" && args[1] === "install").map((args) => args.at(-1))).toEqual(["centrifuge@6.0.0"]);
});
test("reviewer notes outside the bot-managed MR description survive another nightly", async () => {
  const f = fixture(); expect(await f.execute()).toBe(0);
  f.api.mrs[0].description += "\n\nReviewer notes: check the websocket API.";
  expect(await f.execute()).toBe(0);
  expect(f.api.mrs[0].description).toContain("Reviewer notes: check the websocket API.");
});
test("unrelated direct dependencies form separate npm groups", () => {
  const f = fixture();
  const other = finding(3); other.occurrences[0] = { package: "other", entry: "other", fix: true };
  expect(planRepairs([...f.report.findings, other], f.root)).toHaveLength(2);
});
test("a concurrent manual commit during preparation prevents the bot write", async () => {
  const f = fixture(); expect(await f.execute()).toBe(0);
  const mr = f.api.mrs[0], previous = f.api.branches.get(mr.source_branch);
  const audit = f.repairer.auditNpm;
  f.repairer.requiredVersion = "6.0.0";
  f.report.findings.forEach((item) => { item.occurrences[0].fix.version = "6.0.0"; });
  let raced = false;
  f.repairer.auditNpm = async (...args) => {
    const result = await audit(...args);
    if (!result[1].length && !raced) {
      raced = true;
      const human = { ...previous, id: "e".repeat(40), parent_ids: [previous.id], message: "concurrent human change" };
      f.api.branches.set(mr.source_branch, human); f.api.commits.set(human.id, human);
    }
    return result;
  };
  const count = f.api.calls.length;
  expect(await f.execute()).toBe(1);
  expect(f.api.calls).toHaveLength(count);
  expect(f.api.branches.get(mr.source_branch).id).toBe("e".repeat(40));
});
test("existing per-task MRs are retained without creating a grouped duplicate or canceling CI", async () => {
  const f = fixture();
  f.api.mrs.push({ iid: 1, source_branch: "hotfix/APP-1-security", target_branch: "master", description: "old MR", web_url: "https://gl.example/mr/1" });
  expect(await f.execute()).toBe(1);
  expect(f.api.mrs).toHaveLength(1);
  expect(f.api.calls).toHaveLength(0);
  expect(f.report.findings[0].repair.reason).toContain("manual consolidation");
});
test("new master content is carried into an existing bot branch without rewriting history", async () => {
  const f = fixture(); expect(await f.execute()).toBe(0);
  const mr = f.api.mrs[0], previous = groupState(mr.description).head;
  const manifest = read(path.join(f.root, "package.json")); manifest.dependencies.other = "1.1.0";
  save(path.join(f.root, "package.json"), manifest);
  exec(["git", "add", "package.json"], { cwd: f.root });
  exec(["git", "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", "commit", "-qm", "master advanced"], { cwd: f.root });
  const current = exec(["git", "rev-parse", "HEAD"], { cwd: f.root }).stdout.trim();
  const base = f.api.commits.get(f.base);
  const next = { ...base, id: current, parent_ids: [f.base], tree: { ...base.tree, "package.json": fs.readFileSync(path.join(f.root, "package.json")) }, files: { ...base.files, "package.json": current } };
  f.api.commits.set(current, next); f.api.branches.set("master", next);
  f.report.config.sha = current;
  expect(await f.execute()).toBe(0);
  const state = groupState(mr.description);
  expect(state.scan).toBe(current);
  expect(state.base).toBe(f.base);
  expect(f.api.commits.get(state.head).parent_ids).toEqual([previous]);
  expect(JSON.parse(f.api.commits.get(state.head).tree["package.json"].toString()).dependencies.other).toBe("1.1.0");
});

test("audit-confirmed additional CVEs share the same MR instead of producing another repair", async () => {
  const f = fixture();
  const extra = finding(9); extra.occurrences[0] = { package: "other", entry: "other", fix: true };
  expect(planRepairs([...f.report.findings, extra], f.root)[0].group.keys).toEqual(["npm:centrifuge"]);
  f.report.findings.push(extra);
  expect(planRepairs(f.report.findings, f.root)).toHaveLength(2);
  expect(await f.execute()).toBe(0);
  expect(f.api.mrs).toHaveLength(1);
  expect(f.report.findings[2].repair.mr).toBe(f.report.findings[0].repair.mr);
  expect(f.api.mrs[0].description).toContain(extra.id);
});

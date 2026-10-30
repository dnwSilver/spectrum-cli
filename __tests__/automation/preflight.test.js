const { fs, path, temp, remove, save, read } = require("../../src/automation");
const {
  required,
  credentialPair,
  httpsEndpoint,
  checkGitlabAccess,
  checkYouTrackAccess,
  checkRegistryAccess,
} = require("../../src/preflight/automation");
const { reconcile } = require("../../src/security/tracking");
const { Repairer } = require("../../src/security/repair");
const { execute: resolve } = require("../../src/sbom/resolve");
const { Publisher } = require("../../src/sbom/populate");
const ENV = {
  CI_SERVER_URL: "https://gitlab.example.com",
  CI_API_V4_URL: "https://gitlab.example.com/api/v4",
  GLAB_BOT_PAT: "fake-secret-token",
};
const YT = {
  YOUTRACK_URL: "https://issues.example.com",
  YOUTRACK_PRIVATE_TOKEN: "fake-secret-token",
};
const CFG = {
  project_id: "123",
  project_path: "example/app",
  pipeline_id: "456",
  pipeline_url: "https://gitlab.example.com/pipelines/456",
  branch: "main",
  sha: "a".repeat(40),
  youtrack_project: "APP",
  subsystem: "",
  tester: "qa.user",
  time_article: "security",
};
let dirs;
beforeEach(() => {
  dirs = [];
});
afterEach(() => dirs.forEach(remove));
const directory = () => {
  const d = temp("preflight-test-");
  dirs.push(d);
  return d;
};
function glab({
  scope = ["api"],
  level = 40,
  active = true,
  archived = false,
} = {}) {
  return {
    post: jest.fn(),
    get: jest.fn(async (location) => {
      if (location === "user") return { id: 1, state: "active" };
      if (location === "personal_access_tokens/self")
        return { active, revoked: false, scopes: scope };
      if (/\/members\/all\/1$/.test(location))
        return { id: 1, access_level: level };
      if (location.startsWith("projects/"))
        return {
          permissions: { project_access: { access_level: level } },
          archived,
        };
      throw Error("unexpected GET");
    }),
  };
}
function yt({
  banned = false,
  missingProject = false,
  missingField = false,
} = {}) {
  return {
    post: jest.fn(),
    get: jest.fn(async (location, { query } = {}) => {
      if (location === "users/me")
        return { id: "1", login: "bot", guest: false, banned };
      if (location === "admin/projects")
        return missingProject
          ? []
          : [{ id: query.query, shortName: query.query, archived: false }];
      if (location.endsWith("/customFields"))
        return (
          missingField
            ? []
            : [
                "CVE ID",
                "Severity",
                "Priority",
                "Type",
                "Tester",
                "Статья учета времени",
              ]
        ).map((name) => ({ field: { name } }));
      if (location === "issues") return [];
      throw Error("unexpected GET");
    }),
  };
}
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
    httpsEndpoint(value, "YOUTRACK_URL");
    throw Error("unexpected success");
  } catch (error) {
    expect(error.message).toContain("YOUTRACK_URL");
    expect(error.message).not.toContain("secret");
  }
});
test("GitLab identity, token scope and effective project role are checked using GET only", async () => {
  const api = glab();
  expect(
    await checkGitlabAccess(ENV, ["automation/security"], { api, write: true }),
  ).toMatchObject({
    identity: "verified",
    token_scope: "verified",
    project_role: "verified",
  });
  expect(api.post).not.toHaveBeenCalled();
});
test("inherited Developer membership satisfies the project write preflight", async () => {
  const api = glab();
  const originalGet = api.get.getMockImplementation();
  api.get.mockImplementation(async (location) => location.startsWith("projects/") ? {
    permissions: { project_access: null, group_access: { access_level: 30 } },
  } : originalGet(location));
  await expect(checkGitlabAccess(ENV, ["example/app"], { api, write: true })).resolves.toMatchObject({ project_role: "verified" });
  expect(api.post).not.toHaveBeenCalled();
});
test("access errors identify the actual token user and tracker project, even if application access is sufficient", async () => {
  const api = glab();
  const originalGet = api.get.getMockImplementation();
  api.get.mockImplementation(async (location) => {
    if (location === "user") return { id: 1, username: "group_bot", state: "active" };
    if (location.endsWith("/members/all/1")) return { id: 1, access_level: 20 };
    if (location.startsWith("projects/")) return {
      path_with_namespace: location === "projects/example%2Fapp" ? "example/app" : "automation/security",
      permissions: { project_access: null, group_access: { access_level: location === "projects/example%2Fapp" ? 30 : 20 } },
    };
    return originalGet(location);
  });
  await checkGitlabAccess(ENV, ["example/app"], { api, write: true });
  let message;
  try {
    await checkGitlabAccess(ENV, ["automation/security"], { api, write: true, purpose: "pipeline" });
  } catch (error) { message = error.message; }
  expect(message).toContain('project "automation/security"');
  expect(message).toContain("@group_bot (id 1)");
  expect(message).toContain("operation pipeline");
  expect(message).toContain("access level 20");
  expect(message).not.toContain(ENV.GLAB_BOT_PAT);
  expect(api.post).not.toHaveBeenCalled();
});
test.each([20, 30])("effective invited-group membership is accepted for required access %i", async (level) => {
  const api = glab();
  const originalGet = api.get.getMockImplementation();
  api.get.mockImplementation(async (location) => {
    if (location.endsWith("/members/all/1")) return { id: 1, access_level: level };
    if (location.startsWith("projects/")) return { permissions: { project_access: null, group_access: null } };
    return originalGet(location);
  });
  await expect(checkGitlabAccess(ENV, ["automation/security"], { api, write: level === 30, purpose: "pipeline" }))
    .resolves.toMatchObject({ project_role: "verified" });
  expect(api.get).toHaveBeenCalledWith("projects/automation%2Fsecurity/members/all/1");
  expect(api.post).not.toHaveBeenCalled();
});
test.each([404, 403])("effective membership HTTP %i remains an error without leaking response data", async (status) => {
  const api = glab({ level: 0 });
  const originalGet = api.get.getMockImplementation();
  api.get.mockImplementation(async (location) => {
    if (location.endsWith("/members/all/1")) throw Object.assign(Error("private-server-response"), { status });
    return originalGet(location);
  });
  let message;
  try { await checkGitlabAccess(ENV, ["automation/security"], { api, write: true }); }
  catch (error) { message = error.message; }
  expect(message).toContain('project "automation/security"');
  expect(message).toContain(status === 403 ? "HTTP 403" : "Developer access");
  expect(message).not.toContain("private-server-response");
  expect(api.post).not.toHaveBeenCalled();
});
test("membership of another user cannot satisfy the token user's preflight", async () => {
  const api = glab({ level: 0 });
  const originalGet = api.get.getMockImplementation();
  api.get.mockImplementation(async (location) => location.endsWith("/members/all/1") ?
    { id: 2, access_level: 50 } : originalGet(location));
  await expect(checkGitlabAccess(ENV, ["automation/security"], { api, write: true }))
    .rejects.toThrow("membership response is invalid");
  expect(api.post).not.toHaveBeenCalled();
});
test.each([
  { scope: ["read_api"] },
  { level: 20 },
  { active: false },
  { archived: true },
])("GitLab rejects insufficient access: %j", async (options) => {
  const api = glab(options);
  await expect(
    checkGitlabAccess(ENV, ["automation/security"], { api, write: true }),
  ).rejects.toThrow();
  expect(api.post).not.toHaveBeenCalled();
});
test("GitLab rejects mismatched API origin before token use", async () => {
  const api = glab();
  await expect(
    checkGitlabAccess(
      { ...ENV, CI_API_V4_URL: "https://other.example/api/v4" },
      ["123"],
      { api },
    ),
  ).rejects.toThrow("match");
  expect(api.get).not.toHaveBeenCalled();
});
test.each([401, 403])(
  "invalid or forbidden token reports HTTP %i without response secrets",
  async (status) => {
    const api = glab();
    api.get.mockRejectedValue(
      Object.assign(Error("secret from server"), { status }),
    );
    await expect(checkGitlabAccess(ENV, ["123"], { api })).rejects.toThrow(
      "HTTP " + status,
    );
    try {
      await checkGitlabAccess(ENV, ["123"], { api });
    } catch (error) {
      expect(error.message).not.toContain("secret");
    }
  },
);
test("YouTrack validates user, both projects, fields and read access; does not claim write proof", async () => {
  const api = yt(),
    result = await checkYouTrackAccess(YT, CFG, api);
  expect(result).toMatchObject({
    identity: "verified",
    required_fields: "verified",
    write_permissions: "checked_by_operations",
  });
  expect(api.post).not.toHaveBeenCalled();
});
test.each([{ banned: true }, { missingProject: true }, { missingField: true }])(
  "YouTrack blocks before any creation for %j",
  async (options) => {
    const api = yt(options);
    await expect(checkYouTrackAccess(YT, CFG, api)).rejects.toThrow();
    expect(api.post).not.toHaveBeenCalled();
  },
);
test("YouTrack URL and token are required with no built-in deployment default", async () => {
  const api = yt();
  await expect(checkYouTrackAccess({}, CFG, api)).rejects.toThrow(
    "YOUTRACK_URL, YOUTRACK_PRIVATE_TOKEN",
  );
  expect(api.get).not.toHaveBeenCalled();
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
test("reconcile with read-only token never starts a downstream pipeline and keeps error artifact", async () => {
  const cwd = directory();
  save(path.join(cwd, "security-report/findings.json"), {
    schemaVersion: 1,
    config: CFG,
    findings: [{ id: "CVE-2099-12345" }],
    errors: [],
  });
  const api = glab({ scope: ["read_api"] });
  const env = {
    ...ENV,
    NIGHTLY_TRACKER_PROJECT: "automation/security",
    NIGHTLY_COMPONENT_SHA: "a".repeat(40),
    NIGHTLY_SCAN_JOB_ID: "1",
    CI_PROJECT_ID: "123",
  };
  expect(await reconcile({ cwd, env, deps: { api } })).toBe(1);
  expect(api.post).not.toHaveBeenCalled();
  expect(
    read(path.join(cwd, "security-report/tracked.json")).errors.join(" "),
  ).toContain("api scope");
});
test("repair preflight failure publishes no commit or MR and creates a failure report", async () => {
  const cwd = directory();
  save(path.join(cwd, "security-report/tracked.json"), {
    config: CFG,
    findings: [
      {
        id: "CVE-2099-12345",
        severity: "HIGH",
        sources: ["npm"],
        occurrences: [],
      },
    ],
    errors: [],
  });
  const api = glab({ level: 20 });
  const repairer = new Repairer(ENV, { api });
  expect(await repairer.repair(cwd)).toBe(1);
  expect(api.post).not.toHaveBeenCalled();
  expect(
    read(path.join(cwd, "security-report/final.json")).findings[0].repair
      .status,
  ).toBe("blocked");
  expect(fs.existsSync(path.join(cwd, "security-report/message.json"))).toBe(
    true,
  );
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

#!/usr/bin/env node
const fs = require("fs");
const os = require("os");
const path = require("path");

jest.mock("fs");
jest.mock("os", () => ({
  homedir: jest.fn(() => "/tmp/spectrum-home"),
}));
jest.mock("../src/utils", () => ({
  logSuccess: jest.fn(),
  logError: jest.fn(),
  colors: {
    yellow: "",
    reset: "",
  },
}));

const utils = require("../src/utils");
const token = require("../src/token");

function jsonResponse(status, data, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (data === undefined ? "" : JSON.stringify(data)),
    headers: {
      get: (name) => headers[name] || "",
    },
  };
}

function emptyResponse(status) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => "",
    headers: {
      get: () => "",
    },
  };
}

describe("token helpers", () => {
  test("parseConfig reads fields and lists", () => {
    const parsed = token.parseConfig([
      "bot: example-bot",
      "token_ttl_months: 6",
      "groups:",
      "  - https://gitlab.example.test/example-group",
      "projects:",
      "  - https://gitlab.example.test/acme/demo-app",
    ].join("\n"));

    expect(parsed).toEqual({
      bot: "example-bot",
      tokenTtlMonths: 6,
      groups: ["https://gitlab.example.test/example-group"],
      projects: ["https://gitlab.example.test/acme/demo-app"],
    });
  });

  test("validateConfig rejects missing bot and bad ttl", () => {
    expect(token.validateConfig({ bot: "", tokenTtlMonths: 6, groups: ["a"], projects: [] }).ok).toBe(false);
    expect(token.validateConfig({ bot: "bot", tokenTtlMonths: 0, groups: ["a"], projects: [] }).ok).toBe(false);
    expect(token.validateConfig({ bot: "bot", tokenTtlMonths: 6, groups: [], projects: [] }).ok).toBe(false);
    expect(token.validateConfig({ bot: "bot", tokenTtlMonths: 6, groups: ["a"], projects: [] }).ok).toBe(true);
  });

  test("parseGitlabUrl extracts origin and encoded path", () => {
    expect(token.parseGitlabUrl("https://gitlab.example.test/acme/demo-app")).toEqual({
      origin: "https://gitlab.example.test",
      path: "acme/demo-app",
      encodedPath: "acme%2Fdemo-app",
      url: "https://gitlab.example.test/acme/demo-app",
    });
  });

  test("addMonths and buildDescription use config values", () => {
    expect(token.addMonths(new Date("2026-08-17T00:00:00.000Z"), 6)).toBe("2027-02-17");
    expect(token.buildDescription("example-bot", "2027-02-17")).toBe(
      "PAT от бота example-bot, владелец Колосов. Истекает 2027-02-17."
    );
  });
});

describe("token rotate", () => {
  const configPath = path.join("/tmp/spectrum-home", ".config", "spectrum-cli", "config.yaml");
  const validConfig = [
    "bot: example-bot",
    "token_ttl_months: 6",
    "groups:",
    "  - https://gitlab.example.test/example-group",
    "projects:",
    "  - https://gitlab.example.test/acme/demo-app",
    "",
  ].join("\n");

  beforeEach(() => {
    jest.clearAllMocks();
    os.homedir.mockReturnValue("/tmp/spectrum-home");
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(validConfig);
    fs.mkdirSync.mockImplementation(() => {});
    fs.writeFileSync.mockImplementation(() => {});
    token.promptPrivateToken = jest.fn().mockResolvedValue("glpat-user-token");
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-08-17T00:00:00.000Z"));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test("loadOrCreateConfig creates file when missing", () => {
    fs.existsSync.mockReturnValue(false);
    fs.readFileSync.mockReturnValue(validConfig);

    const result = token.loadOrCreateConfig();

    expect(result.ok).toBe(true);
    expect(fs.mkdirSync).toHaveBeenCalledWith(path.dirname(configPath), { recursive: true });
    expect(fs.writeFileSync).toHaveBeenCalledWith(configPath, token.defaultConfigContent(), "utf8");
    expect(result.data.bot).toBe("example-bot");
    expect(result.data.targets).toHaveLength(2);
  });

  test("loadOrCreateConfig fails on empty lists", () => {
    fs.readFileSync.mockReturnValue("bot: x\ntoken_ttl_months: 6\ngroups:\nprojects:\n");
    expect(token.loadOrCreateConfig().ok).toBe(false);
  });

  test("tokenRotate hangs provided token on groups and projects", async () => {
    const calls = [];
    global.fetch = jest.fn(async (url, options) => {
      calls.push({ method: options.method, url, body: options.body });
      if (url.includes("/groups/example-group") && options.method === "GET" && !url.includes("/variables")) {
        return jsonResponse(200, { id: 1 });
      }
      if (url.includes("/projects/acme%2Fdemo-app") && options.method === "GET" && !url.includes("/variables")) {
        return jsonResponse(200, { id: 2 });
      }
      if (url.includes("/variables") && options.method === "GET") {
        return jsonResponse(200, [{ key: "GITLAB_PRIVATE_TOKEN" }]);
      }
      if (url.includes("/variables/GITLAB_PRIVATE_TOKEN") && options.method === "DELETE") {
        return emptyResponse(204);
      }
      if (url.includes("/variables") && options.method === "POST") {
        return jsonResponse(201, { key: "GITLAB_PRIVATE_TOKEN" });
      }
      return jsonResponse(404, { message: "not found" });
    });

    await expect(token.tokenRotate()).resolves.toBe(true);

    expect(calls.some((call) => call.url.includes("/personal_access_tokens"))).toBe(false);
    expect(calls.some((call) => call.url.endsWith("/user"))).toBe(false);

    const createVar = calls.filter((call) => call.method === "POST" && call.url.includes("/variables"));
    expect(createVar).toHaveLength(2);
    expect(JSON.parse(createVar[0].body)).toEqual({
      key: "GITLAB_PRIVATE_TOKEN",
      value: "glpat-user-token",
      masked_and_hidden: true,
      description: "PAT от бота example-bot, владелец Колосов. Истекает 2027-02-17.",
    });

    const logged = utils.logSuccess.mock.calls.concat(utils.logError.mock.calls).map((args) => args.join(" "));
    expect(logged.some((line) => line.includes("glpat-user-token"))).toBe(false);
    expect(logged.some((line) => line.includes("example-group"))).toBe(true);
    expect(logged.some((line) => line.includes("acme/demo-app"))).toBe(true);
  });

  test("tokenRotate stops when group is inaccessible", async () => {
    global.fetch = jest.fn(async () => jsonResponse(404, { message: "not found" }));

    await expect(token.tokenRotate()).resolves.toBe(false);
    expect(utils.logError).toHaveBeenCalled();
  });

  test("tokenRotate creates variable when it is missing", async () => {
    global.fetch = jest.fn(async (url, options) => {
      if (options.method === "GET" && url.includes("/groups/")) {
        return jsonResponse(200, { id: 1 });
      }
      if (options.method === "GET" && url.includes("/projects/")) {
        return jsonResponse(200, { id: 2 });
      }
      if (url.includes("/variables") && options.method === "GET") {
        return jsonResponse(200, []);
      }
      if (url.includes("/variables") && options.method === "POST") {
        return jsonResponse(201, { key: "GITLAB_PRIVATE_TOKEN" });
      }
      return jsonResponse(404, {});
    });

    await expect(token.tokenRotate()).resolves.toBe(true);
  });

  test("askPrivateToken fails when prompt is empty", async () => {
    token.promptPrivateToken = jest.fn().mockResolvedValue("");
    await expect(token.askPrivateToken({ tokenTtlMonths: 6, bot: "example-bot" })).resolves.toEqual({
      ok: false,
      reason: "GITLAB_PRIVATE_TOKEN не указан.",
    });
  });
});

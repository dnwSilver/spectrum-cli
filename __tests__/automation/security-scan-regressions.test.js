const {
  fs,
  path,
  temp,
  remove,
  read,
  save,
  exec,
} = require("../../src/automation");
const { registryAuth, run } = require("../../src/security/runtime");
const { Scanner } = require("../../src/security/scan");
let directories;
beforeEach(() => {
  directories = [];
});
afterEach(() => {
  directories.forEach(remove);
  jest.restoreAllMocks();
});
const directory = () => {
  const value = temp("nightly-regression-");
  directories.push(value);
  return value;
};
const credentials = {
  NEXUS_USER: "test-user",
  NEXUS_PASSWORD: "test-password",
  NIGHTLY_REGISTRY_HOSTS: "images.example",
  NIGHTLY_NPM_REGISTRY: "https://npm.example/repository/proxy/",
};
test("image authentication does not create npm auth or override installation registry", async () => {
  const home = directory(),
    original = path.join(home, "npmrc");
  fs.writeFileSync(original, "registry=https://private.example/\n");
  await registryAuth(
    {
      ...credentials,
      NPM_CONFIG_USERCONFIG: original,
      NPM_CONFIG_REGISTRY: "https://private.example/",
    },
    async (env) => {
      expect(env.NPM_CONFIG_USERCONFIG).toBe(original);
      expect(env.NPM_CONFIG_REGISTRY).toBe("https://private.example/");
      expect(fs.readFileSync(original, "utf8")).toBe(
        "registry=https://private.example/\n",
      );
    },
  );
});
test("initial and repair audits explicitly select public npm despite private registry settings", async () => {
  const { Repairer } = require("../../src/security/repair");
  const root = directory();
  fs.writeFileSync(
    path.join(root, ".npmrc"),
    "registry=https://private.example/\n",
  );
  const runner = jest.fn(() => ({
    status: 0,
    stdout: JSON.stringify({ vulnerabilities: {} }),
  }));
  for (const Action of [Scanner, Repairer]) {
    const action = new Action(
      { NIGHTLY_NPM_REGISTRY: "https://private.example/" },
      { run: runner },
    );
    await expect(action.auditNpm(root)).resolves.toEqual([
      { vulnerabilities: {} },
      [],
    ]);
  }
  expect(runner).toHaveBeenCalledTimes(2);
  for (const [argv] of runner.mock.calls) {
    expect(argv).toContain("--registry=https://registry.npmjs.org/");
    expect(argv).toContain("--omit=dev");
    expect(argv).toContain("--audit-level=high");
  }
});
test("generic subprocess errors keep raw stderr private; security diagnostics redact credentials", () => {
  let generic;
  try {
    exec([
      process.execPath,
      "-e",
      'console.error("private-value"); process.exit(1)',
    ]);
  } catch (error) {
    generic = error;
  }
  expect(generic.message).not.toContain("private-value");
  expect(JSON.stringify(generic)).not.toContain("private-value");
  let failure;
  const auth = Buffer.from("test-user:test-password").toString("base64");
  try {
    run(
      [
        process.execPath,
        "-e",
        `console.error('denied test-password ${auth}'); process.exit(1)`,
      ],
      undefined,
      {},
      credentials,
    );
  } catch (error) {
    failure = error;
  }
  expect(failure.message).toContain("denied [REDACTED] [REDACTED]");
  expect(failure.message).not.toContain("test-password");
});
test("registry 401 retains useful evidence and reports authentication failure", async () => {
  const root = directory(),
    evidence = path.join(root, "npm.json");
  const report = {
    message: 'Unable to authenticate, need: BASIC realm="Repository Manager"',
    statusCode: 401,
    error: { summary: "", detail: "" },
  };
  const scanner = new Scanner(
    {},
    { run: () => ({ status: 1, stdout: JSON.stringify(report), stderr: "" }) },
  );
  await expect(scanner.auditNpm(root, evidence)).rejects.toThrow(
    "401): Unable to authenticate",
  );
  expect(read(evidence)).toEqual(report);
  expect(read(path.join(root, "npm-command.json")).status).toBe(1);
});
test("HIGH findings with npm exit 1 are successful scan data", async () => {
  const report = {
    vulnerabilities: {
      widget: {
        via: [
          {
            name: "widget",
            severity: "high",
            url: "https://github.com/advisories/GHSA-aaaa-bbbb-cccc",
            range: "<2",
          },
        ],
        nodes: ["node_modules/widget"],
        fixAvailable: true,
      },
    },
  };
  const scanner = new Scanner(
    {},
    {
      run: () => ({ status: 1, stdout: JSON.stringify(report) }),
      aliases: async (key) => [key],
    },
  );
  expect((await scanner.auditNpm(directory()))[1]).toHaveLength(1);
});
test("invalid npm JSON reports redacted stderr", async () => {
  const scanner = new Scanner(credentials, {
    run: () => ({
      status: 1,
      stdout: "<html>error</html>",
      stderr: "denied test-password",
    }),
  });
  await expect(scanner.auditNpm(directory())).rejects.toThrow(
    "invalid JSON: denied [REDACTED]",
  );
});
test("Trivy evidence survives unavailable Node metadata", async () => {
  const evidence = path.join(directory(), "runtime.json");
  const scanner = new Scanner(
    {},
    {
      run: (args) => {
        if (args[0] === "trivy")
          save(args[args.indexOf("--output") + 1], {
            SchemaVersion: 2,
            Results: [],
          });
        return { stdout: "", status: 0 };
      },
    },
  );
  scanner.nodeVersion = () => {
    throw new Error("node check unavailable");
  };
  await expect(
    scanner.scanImage("image", "linux/amd64", undefined, evidence),
  ).rejects.toThrow("node check unavailable");
  expect(read(evidence)).toEqual({ SchemaVersion: 2, Results: [] });
});

test("scan reads published metadata and runs only remote Trivy, without container tools", async () => {
  const report = { SchemaVersion: 2, Results: [] };
  const registry = {
    nodeVersion: jest.fn(async () => "24.22.1"),
  };
  const runner = jest.fn((args) => {
    expect(args.slice(0, 4)).toEqual(["trivy", "image", "--image-src", "remote"]);
    save(args[args.indexOf("--output") + 1], report);
    return { status: 0, stdout: "" };
  });
  const scanner = new Scanner({}, { registry, run: runner });
  expect(await scanner.scanImage("image", "linux/arm64", { 1: { vulnerable: "<24", patched: ">=24", severity: "high" } })).toEqual([report, [], "24.22.1"]);
  expect(registry.nodeVersion).toHaveBeenCalledWith("image", "linux/arm64", report);
  expect(runner).toHaveBeenCalledTimes(1);
});
test("numeric runtime candidates use registry tags and preserve the original tag and port", async () => {
  const { Repairer } = require("../../src/security/repair");
  const image = "registry.example:5443/node/runtime:24.22.1.9";
  const digest = "sha256:" + "b".repeat(64);
  const registry = {
    immutableImage: async () => image + "@" + digest,
    tags: jest.fn(async () => ["24.22.1.9", "24.22.1.10", "25.0.0.1"]),
  };
  const runner = jest.fn();
  const repairer = new Repairer({}, { registry, run: runner });
  const immutable = await repairer.immutableImage(image);
  expect(immutable).toBe(image + "@" + digest);
  expect(await repairer.imageCandidates(immutable)).toEqual(["registry.example:5443/node/runtime:24.22.1.10"]);
  expect(registry.tags).toHaveBeenCalledWith(immutable);
  expect(runner).not.toHaveBeenCalled();
});

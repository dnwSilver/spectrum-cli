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
test("npm authentication is scoped, private, preserves user configuration and is always removed", async () => {
  const home = directory(),
    original = path.join(home, "npmrc");
  fs.writeFileSync(original, "fetch-retries=1\n");
  let file;
  await expect(
    registryAuth(
      { ...credentials, NPM_CONFIG_USERCONFIG: original },
      async (env) => {
        file = env.NPM_CONFIG_USERCONFIG;
        expect(env.NPM_CONFIG_REGISTRY).toBe(credentials.NIGHTLY_NPM_REGISTRY);
        expect(fs.statSync(file).mode & 0o777).toBe(0o600);
        expect(fs.readFileSync(file, "utf8")).toBe(
          "fetch-retries=1\n//npm.example/repository/proxy/:_auth=" +
            Buffer.from("test-user:test-password").toString("base64") +
            "\n",
        );
        expect(fs.readFileSync(original, "utf8")).toBe("fetch-retries=1\n");
        throw new Error("operation failed");
      },
    ),
  ).rejects.toThrow("operation failed");
  expect(fs.existsSync(file)).toBe(false);
});
test.each([
  "http://npm.example/",
  "https://user:password@npm.example/",
  "https://npm.example/?token=x",
])("rejects unsafe npm registry %s", async (url) => {
  const action = jest.fn();
  await expect(
    registryAuth({ ...credentials, NIGHTLY_NPM_REGISTRY: url }, action),
  ).rejects.toThrow("HTTPS registry URL");
  expect(action).not.toHaveBeenCalled();
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
test("Nexus 401 retains useful evidence and reports authentication failure", async () => {
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
test("actual Node execution uses unpacked OCI rootfs, drops uid and cleans up", () => {
  let workingDirectory;
  const scanner = new Scanner(
    {},
    {
      run: (args) => {
        if (args[0] === "chroot") {
          workingDirectory = path.dirname(path.dirname(args[2]));
          expect(args[1]).toBe("--userspec=65534:65534");
          expect(args.slice(-2)).toEqual(["/nodejs/bin/node", "--version"]);
          return { stdout: "v24.22.1\n", status: 0 };
        }
        return { stdout: "", status: 0 };
      },
    },
  );
  expect(
    scanner.nodeVersion(
      "registry.example/runtime@sha256:" + "a".repeat(64),
      "linux/amd64",
    ),
  ).toBe("24.22.1");
  expect(fs.existsSync(workingDirectory)).toBe(false);
});
test("runtime execution failure remains visible and work directory is removed", () => {
  let workingDirectory;
  const scanner = new Scanner(
    {},
    {
      run: (args) => {
        if (args[0] === "chroot") {
          workingDirectory = path.dirname(path.dirname(args[2]));
          throw new Error("runtime binary cannot execute");
        }
        return { stdout: "", status: 0 };
      },
    },
  );
  expect(() => scanner.nodeVersion("image", "linux/amd64")).toThrow(
    "runtime binary cannot execute",
  );
  expect(fs.existsSync(workingDirectory)).toBe(false);
});
test("Trivy evidence survives a later Node execution failure", async () => {
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

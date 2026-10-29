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

test.each([
  ["registry.example/node/runtime:24.22.1.9", "registry.example/node/runtime"],
  [
    "registry.example:5443/team/runtime:24.22.1.9",
    "registry.example:5443/team/runtime",
  ],
  ["registry.example:5443/team/runtime", "registry.example:5443/team/runtime"],
  ["node:24.22.1", "node"],
])(
  "Skopeo uses digest without tag while preserving report metadata: %s",
  (name, repository) => {
    const digest = "sha256:" + "a".repeat(64);
    const reference = name + "@" + digest;
    const calls = [];
    const scanner = new Scanner(
      {},
      {
        run: (args) => {
          calls.push(args);
          return {
            status: 0,
            stdout: args[0] === "chroot" ? "v24.22.1\n" : digest,
          };
        },
      },
    );
    const immutable = scanner.immutableImage(reference);
    expect(immutable).toBe(reference);
    expect(scanner.nodeVersion(immutable, "linux/amd64")).toBe("24.22.1");
    const sources = calls
      .filter((args) => args[0] === "skopeo")
      .flatMap((args) => args.filter((arg) => arg.startsWith("docker://")));
    expect(sources).toEqual([
      "docker://" + repository + "@" + digest,
      "docker://" + repository + "@" + digest,
    ]);
  },
);
test("tag resolution and numeric repair candidates keep their original tag", () => {
  const { Repairer } = require("../../src/security/repair");
  const digest = "sha256:" + "b".repeat(64);
  const runner = jest.fn((args) => ({
    status: 0,
    stdout:
      args[1] === "list-tags"
        ? JSON.stringify({ Tags: ["24.22.1.9", "24.22.1.10"] })
        : digest,
  }));
  const repairer = new Repairer({}, { run: runner });
  const image = "registry.example:5443/node/runtime:24.22.1.9";
  const immutable = repairer.immutableImage(image);
  expect(runner.mock.calls[0][0]).toContain("docker://" + image);
  expect(immutable).toBe(image + "@" + digest);
  expect(repairer.imageCandidates(immutable)).toEqual([
    "registry.example:5443/node/runtime:24.22.1.10",
  ]);
});

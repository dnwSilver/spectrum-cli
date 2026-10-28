// Run the actual inline job script: no package scripts or downloaded Next code.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = (name, fn) =>
  global.test(name, async () => {
    const cleanup = [];
    try {
      await fn({ after: (action) => cleanup.push(action) });
    } finally {
      cleanup.reverse().forEach((action) => action());
    }
  });
const cli = path.join(__dirname, "../../index.js");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "standalone-licenses-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  function write(file, contents) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, contents);
  }
  function add({
    prefix = "",
    version = "99.8.7",
    name = "arbitrary-package",
    license = true,
  } = {}) {
    const relative = path.join(prefix, "node_modules/next");
    const source = path.join(root, relative);
    const target = path.join(root, "dist/standalone", relative);
    const owner = JSON.stringify({ name: "next", version });
    const manifest = JSON.stringify({ name, main: "index.js" });
    const sourcePackage = path.join(source, "dist/compiled", name);
    const targetPackage = path.join(target, "dist/compiled", name);
    for (const ownerRoot of [source, target])
      write(path.join(ownerRoot, "package.json"), owner);
    for (const pkg of [sourcePackage, targetPackage]) {
      write(path.join(pkg, "package.json"), manifest);
      write(path.join(pkg, "index.js"), 'module.exports = "fixture";\n');
      write(path.join(pkg, "data/config.json"), '{"fixture":true}');
    }
    if (license)
      write(path.join(sourcePackage, "LICENSE"), "Fixture license\n");
    return { source, target, sourcePackage, targetPackage };
  }
  function run({ shell = false, framework = "nextjs", enabled = "true" } = {}) {
    const execution = spawnSync(process.execPath, [cli, "nextjs", "licenses"], {
      cwd: root,
      encoding: "utf8",
      timeout: 10000,
      env: { ...process.env, CI: "true" },
    });
    assert.ifError(execution.error);
    const line = execution.stdout
      .split("\n")
      .find((x) => x.startsWith("Standalone LICENSE preservation: "));
    return {
      ...execution,
      report: line ? JSON.parse(line.split(": ").slice(1).join(": ")) : null,
    };
  }
  return { root, write, add, run };
}

test("standalone helper enables LICENSE preservation by default", (t) => {
  const f = fixture(t),
    p = f.add();
  const result = f.run({ shell: true });
  assert.equal(result.status, 0);
  assert.equal(result.report.copied, 1);
  assert.equal(fs.existsSync(path.join(p.targetPackage, "LICENSE")), true);
});

test("copies only LICENSE for already traced packages; code unchanged and idempotent", (t) => {
  const f = fixture(t),
    p = f.add();
  f.write(
    path.join(p.source, "dist/compiled/not-traced/package.json"),
    '{"name":"not-traced"}',
  );
  f.write(
    path.join(p.source, "dist/compiled/not-traced/LICENSE"),
    "not traced",
  );
  const before = fs.readFileSync(path.join(p.targetPackage, "index.js"));
  const result = f.run();
  assert.equal(result.status, 0);
  assert.equal(result.report.copied, 1);
  assert.deepEqual(
    fs.readFileSync(path.join(p.targetPackage, "LICENSE")),
    fs.readFileSync(path.join(p.sourcePackage, "LICENSE")),
  );
  assert.deepEqual(
    fs.readFileSync(path.join(p.targetPackage, "index.js")),
    before,
  );
  assert.equal(
    fs.existsSync(path.join(p.target, "dist/compiled/not-traced")),
    false,
  );
  const again = f.run();
  assert.equal(again.report.copied, 0);
  assert.equal(again.report.existing, 1);
});

test("multiple installed Next instances, scoped packages and future versions", (t) => {
  const f = fixture(t);
  f.add({ name: "@scope/vendor", version: "999.1.2" });
  f.add({ prefix: "node_modules/another-package", version: "888.2.3" });
  assert.equal(f.run().report.copied, 2);
});

test("packages without a published LICENSE do not get fabricated metadata", (t) => {
  const f = fixture(t),
    p = f.add({ license: false });
  const result = f.run();
  assert.equal(result.status, 0);
  assert.equal(result.report.withoutLicense, 1);
  assert.equal(fs.existsSync(path.join(p.targetPackage, "LICENSE")), false);
});

test("does not restore missing runtime code; full catalogue validation still decides coverage", (t) => {
  const f = fixture(t),
    p = f.add();
  fs.unlinkSync(path.join(p.targetPackage, "index.js"));
  const result = f.run();
  assert.equal(result.report.copied, 1);
  assert.equal(fs.existsSync(path.join(p.targetPackage, "index.js")), false);
});

for (const which of [
  "owner",
  "manifest",
  "code",
  "asset",
  "extra",
  "license",
]) {
  test("does not repair mismatching " + which, (t) => {
    const f = fixture(t),
      p = f.add();
    const files = {
      owner: path.join(p.target, "package.json"),
      manifest: path.join(p.targetPackage, "package.json"),
      code: path.join(p.targetPackage, "index.js"),
      asset: path.join(p.targetPackage, "data/config.json"),
      extra: path.join(p.targetPackage, "extra.js"),
      license: path.join(p.targetPackage, "LICENSE"),
    };
    const changed =
      which === "owner"
        ? '{"name":"next","version":"0.0.1"}'
        : which === "manifest"
          ? '{"name":"wrong"}'
          : "changed";
    f.write(files[which], changed);
    const result = f.run();
    assert.equal(result.status, 2);
    assert.equal(result.report.copied, 0);
    assert.ok(result.report.warnings.length);
    assert.equal(fs.readFileSync(files[which], "utf8"), changed);
    if (which !== "license")
      assert.equal(fs.existsSync(path.join(p.targetPackage, "LICENSE")), false);
  });
}

for (const which of [
  "source-license",
  "target-license",
  "source-package",
  "target-package",
  "output",
]) {
  test(
    "rejects symlink " + which + " without following or overwriting it",
    (t) => {
      const f = fixture(t),
        p = f.add();
      const file =
        which === "source-license"
          ? path.join(p.sourcePackage, "LICENSE")
          : which === "target-license"
            ? path.join(p.targetPackage, "LICENSE")
            : which === "source-package"
              ? p.sourcePackage
              : which === "target-package"
                ? p.targetPackage
                : path.join(f.root, "dist/standalone");
      const stash = path.join(f.root, "unrelated");
      if (fs.existsSync(file)) fs.renameSync(file, stash);
      else f.write(stash, "unrelated");
      fs.symlinkSync(stash, file);
      const result = f.run();
      assert.equal(result.status, 2);
      assert.equal(result.report.copied, 0);
      assert.ok(fs.lstatSync(file).isSymbolicLink());
    },
  );
}

test("missing standalone reports warning and exit 2", (t) => {
  const f = fixture(t);
  const result = f.run();
  assert.equal(result.status, 2);
  assert.ok(result.report.warnings.length);
});

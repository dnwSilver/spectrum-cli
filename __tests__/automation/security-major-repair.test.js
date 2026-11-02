const { fs, path, temp, remove, save } = require("../../src/automation");
const { Repairer } = require("../../src/security/repair");
const CVE = "CVE-2099-12345";
let root;
beforeEach(() => { root = temp("major-repair-test-"); });
afterEach(() => remove(root));
function finding(fix) {
  return {
    id: CVE, aliases: [CVE], severity: "HIGH", sources: ["npm"],
    occurrences: [{ package: "transitive-package", entry: "direct-package", fix }],
  };
}
test.each(["dependencies", "optionalDependencies"])("major fix updates an explicit direct %s version without force or lifecycle scripts", async (group) => {
  save(path.join(root, "package.json"), { [group]: { "direct-package": "1.0.0" } });
  const repairer = new Repairer({});
  repairer.run = jest.fn(() => ({ status: 0, stdout: "" }));
  const value = finding({ name: "direct-package", version: "2.0.0", isSemVerMajor: true });
  repairer.auditNpm = jest.fn(async () => [{}, [value]]);
  await expect(repairer.fixNpm(root, value)).resolves.toEqual([
    { package: "direct-package", version: "2.0.0", major: true },
  ]);
  expect(repairer.run.mock.calls[1][0]).toEqual([
    "npm", "install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--save-exact",
    group === "optionalDependencies" ? "--save-optional" : "--save-prod", "--", "direct-package@2.0.0",
  ]);
});
test.each([
  [{ name: "direct-package", version: "2.0.0 --force", isSemVerMajor: true }, "Invalid npm remediation"],
  [{ name: "direct-package;echo", version: "2.0.0", isSemVerMajor: true }, "Invalid npm remediation"],
  [{ name: "indirect-package", version: "2.0.0", isSemVerMajor: true }, "direct production dependency"],
])("invalid or transitive fixes never reach npm install: %j", async (fix, message) => {
  save(path.join(root, "package.json"), { dependencies: { "direct-package": "1.0.0" }, devDependencies: { "indirect-package": "1.0.0" } });
  const repairer = new Repairer({});
  repairer.run = jest.fn(() => ({ status: 0, stdout: "" }));
  const value = finding(fix);
  repairer.auditNpm = jest.fn(async () => [{}, [value]]);
  await expect(repairer.fixNpm(root, value)).rejects.toThrow(message);
  expect(repairer.run.mock.calls.some(([args]) => args[1] === "install")).toBe(false);
});
test("compatible repair does not install a major version when the target advisory is already gone", async () => {
  const repairer = new Repairer({});
  repairer.run = jest.fn(() => ({ status: 0, stdout: "" }));
  repairer.auditNpm = jest.fn(async () => [{}, []]);
  await expect(repairer.fixNpm(root, finding({ name: "direct-package", version: "2.0.0", isSemVerMajor: true }))).resolves.toEqual([]);
  expect(repairer.run).toHaveBeenCalledTimes(1);
});
test.each([
  [[{ aliases: [CVE] }], "Target advisory remains"],
  [[{ aliases: ["CVE-2099-99999"] }], "introduced new HIGH/CRITICAL"],
])("a major upgrade that fails the repeated audit cannot create a commit or MR", async (remaining, reason) => {
  const sha = "a".repeat(40);
  const value = { ...finding({ name: "direct-package", version: "2.0.0", isSemVerMajor: true }), task: { key: "APP-1" } };
  const report = { config: { project_id: "1", branch: "master", sha }, findings: [value] };
  const api = {
    get: jest.fn(async (location) => /\/(merge_requests|branches)$/.test(location) ? [] : { commit: { id: sha } }),
    post: jest.fn(),
  };
  const repairer = new Repairer({});
  repairer.run = jest.fn(() => ({ status: 0, stdout: "" }));
  repairer.fixNpm = jest.fn(async () => [{ package: "direct-package", version: "2.0.0", major: true }]);
  repairer.commitActions = jest.fn(() => [{ action: "update", file_path: "package-lock.json" }]);
  repairer.auditNpm = jest.fn(async () => [{}, remaining]);
  await expect(repairer.repairOne(api, value, report, root)).rejects.toThrow(reason);
  expect(api.post).not.toHaveBeenCalled();
});

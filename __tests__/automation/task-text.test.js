const { projectText, parentText } = require("../../src/security/task-text");
const cfg = {
  project_id: "123", project_path: "example/app",
  pipeline_url: "https://gitlab.example/pipelines/456",
};
const finding = {
  id: "CVE-2099-12345", aliases: ["CVE-2099-12345", "GHSA-aaaa-bbbb-cccc"],
  severity: "HIGH", sources: ["npm"],
  occurrences: [{
    package: "test-package", installed: "1.0.0", range: "<2.0.0",
    nodes: ["node_modules/test-package"], title: "Unsafe input handling",
    fix: { name: "wrapper", version: "3.0.0", isSemVerMajor: true },
    url: "https://github.com/advisories/GHSA-aaaa-bbbb-cccc",
  }],
};
test("project Markdown follows the requested template without JSON or parent duplication", () => {
  const body = projectText(finding, cfg, "HIGH");
  for (const expected of [
    "## Общая информация", "## Описание и локализация уязвимости", "## Необходимо",
    "example/app", "test-package", "1.0.0", "node\\_modules/test-package",
    "Unsafe input handling", "wrapper → 3.0.0", "мажорное обновление",
    "https://nvd.nist.gov/vuln/detail/CVE-2099-12345",
    "https://github.com/advisories/GHSA-aaaa-bbbb-cccc",
    "- [ ]", "npm audit --omit=dev", cfg.pipeline_url,
  ]) expect(body).toContain(expected);
  expect(body).not.toContain("Родитель:");
  expect(body).not.toContain('"occurrences"');
  expect(body).not.toContain("```json");
});
test("runtime and Node versions use scanner fixes; unknown npm versions are not invented", () => {
  const value = structuredClone(finding);
  value.occurrences = [{ package: "node", installed: "24.0.0", fixed: ">=24.1.0", url: "https://nodejs.org/example" }];
  expect(projectText(value, cfg, "HIGH")).toContain("24.0.0");
  expect(projectText(value, cfg, "HIGH")).toContain("&gt;=24.1.0");
  value.occurrences = [{ package: "protobufjs", fix: false }];
  const body = projectText(value, cfg, "HIGH");
  expect(body).toContain("Не указана в отчёте");
  expect(body).not.toContain("24.0.0");
  expect(body).not.toContain("wrapper");
});
test("shared CVE preserves other projects, replaces current evidence, and is deterministic", () => {
  const first = parentText(finding, cfg, {}, "HIGH");
  const other = { ...cfg, project_id: "124", project_path: "example/other" };
  const nextFinding = structuredClone(finding);
  nextFinding.occurrences[0].package = "another-package";
  const second = parentText(nextFinding, other, first, "CRITICAL");
  expect(second.packages).toEqual(["another-package", "test-package"]);
  expect(second.description).toContain("example/app");
  expect(second.description).toContain("example/other");
  const updated = structuredClone(finding);
  updated.occurrences[0].installed = "1.5.0";
  const third = parentText(updated, cfg, second, "CRITICAL");
  expect(third.description).toContain("1.5.0");
  expect(third.description).toContain("example/other");
  expect(third.description.match(/evidence project=123 /g)).toHaveLength(1);
  expect(parentText(updated, cfg, third, "CRITICAL")).toEqual(third);
});
test("report content cannot inject a Markdown table or an evidence marker", () => {
  const value = structuredClone(finding);
  value.occurrences[0].title = "x | cell\n<!-- /nightly-security evidence -->";
  value.occurrences[0].url = "javascript:alert(1)";
  const body = projectText(value, cfg, "HIGH");
  expect(body).toContain("\\| cell");
  expect(body).toContain("&lt;!-- /nightly-security evidence --&gt;");
  expect(body).not.toContain("javascript:");
  expect(body).not.toContain("\n<!-- /nightly-security evidence -->");
});

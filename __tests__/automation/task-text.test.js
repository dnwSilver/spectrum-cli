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
test("shared CVE preserves common advisory facts only and is deterministic across projects", () => {
  const first = parentText(finding, {}, "HIGH");
  const nextFinding = structuredClone(finding);
  nextFinding.occurrences[0].package = "another-package";
  const second = parentText(nextFinding, first, "CRITICAL");
  expect(second.packages).toEqual(["another-package", "test-package"]);
  for (const body of [first.description, second.description]) {
    for (const forbidden of [cfg.project_path, cfg.pipeline_url, "node_modules", "node\\_modules", "1.0.0", "project=", "Текущая версия", "Локализация"])
      expect(body).not.toContain(forbidden);
    expect(body).toContain("Unsafe input handling");
    expect(body).toContain("&lt;2.0.0");
    expect(body).toContain("3.0.0");
  }
  const updated = structuredClone(finding);
  updated.occurrences[0].installed = "1.5.0";
  updated.occurrences[0].range = "<2.1.0";
  const third = parentText(updated, second, "CRITICAL");
  expect(third.description).not.toContain("1.5.0");
  expect(third.description).toContain("&lt;2.1.0");
  expect(third.description).toContain("another-package");
  expect(third.description.match(/advisory packages=test-package /g)).toHaveLength(1);
  expect(parentText(updated, third, "CRITICAL")).toEqual(third);
});
test("legacy parent migration removes every repository and pipeline but preserves other component facts", () => {
  const legacy = { description: [
    "<!-- nightly-security parent -->",
    "<!-- nightly-security evidence project=999 packages=another-package -->",
    "### spectrum-frontend/elk/elk-site",
    "- **Проект / Сервис:** spectrum-frontend/elk/elk-site",
    "> Another advisory description",
    "| Компонент | Текущая версия | Уязвимый диапазон | Локализация |",
    "| --- | --- | --- | --- |",
    "| another-package | 9.0.0 | &lt;9.1.0 | node_modules/another-package |",
    "",
    "| Свойство | Значение |", "| --- | --- |",
    "| Рекомендуемая безопасная версия | 9.1.0 |",
    "| Ссылка на GitHub | <https://github.com/advisories/GHSA-zzzz-xxxx-yyyy> |",
    "", "**Pipeline проверки:** <https://gitlab.example/elk/-/pipelines/1>",
    "<!-- /nightly-security evidence -->",
  ].join("\r\n") };
  const updated = parentText(finding, legacy, "HIGH");
  expect(updated.packages).toEqual(["another-package", "test-package"]);
  for (const fact of ["Another advisory description", "&lt;9.1.0", "GHSA-zzzz-xxxx-yyyy", "Unsafe input handling"])
    expect(updated.description).toContain(fact);
  for (const forbidden of ["spectrum-frontend", "elk-site", "gitlab.example", "node_modules", "9.0.0", "project=999"])
    expect(updated.description).not.toContain(forbidden);
  expect(parentText(finding, updated, "HIGH")).toEqual(updated);
});
test("report content cannot inject a Markdown table or an evidence marker", () => {
  const value = structuredClone(finding);
  value.occurrences[0].title = "x | cell\n<!-- /nightly-security evidence -->";
  value.occurrences[0].url = "javascript:alert(1)";
  for (const body of [projectText(value, cfg, "HIGH"), parentText(value, {}, "HIGH").description]) {
    expect(body).toContain("\\| cell");
    expect(body).toContain("&lt;!-- /nightly-security evidence --&gt;");
    expect(body).not.toContain("javascript:");
    expect(body).not.toContain("\n<!-- /nightly-security evidence -->");
  }
});

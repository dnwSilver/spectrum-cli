// YouTrack descriptions are Markdown; scanner evidence stays in CI artifacts.
const unique = (values) => [...new Set(values.filter(Boolean))].sort();
const text = (value) => String(value ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/[\\`*_[\]|]/g, "\\$&").replace(/[\r\n]+/g, " ");
const packages = (value) => unique((value.occurrences || []).map((entry) => entry.package || entry.entry));
function link(url) {
  try {
    const parsed = new URL(url);
    if (!["https:", "http:"].includes(parsed.protocol) || parsed.username || parsed.password) return "";
    return `<${parsed.href.replace(/</g, "%3C").replace(/>/g, "%3E")}>`;
  } catch { return ""; }
}
function references(value) {
  const aliases = unique([value.id, ...(value.aliases || [])]);
  const nvd = aliases.filter((id) => /^CVE-\d{4}-\d{4,}$/.test(id))
    .map((id) => link("https://nvd.nist.gov/vuln/detail/" + id));
  const urls = unique((value.occurrences || []).map((entry) => entry.url));
  const github = unique([
    ...aliases.filter((id) => /^GHSA-[a-z0-9-]+$/i.test(id)).map((id) => "https://github.com/advisories/" + id),
    ...urls.filter((url) => { try { return new URL(url).hostname === "github.com"; } catch { return false; } }),
  ]).map(link).filter(Boolean);
  return [
    `| Ссылка на NVD | ${nvd.join("; ") || "Не указана в отчёте"} |`,
    `| Ссылка на GitHub | ${github.join("; ") || "Не указана в отчёте"} |`,
    `| Источники | ${urls.map(link).filter(Boolean).join("; ") || "Не указаны в отчёте"} |`,
  ];
}
function safeVersion(entry) {
  if (entry.fixed) return text(entry.fixed);
  if (entry.fix && typeof entry.fix === "object" && entry.fix.version)
    return `${text(entry.fix.name || entry.package)} → ${text(entry.fix.version)}${entry.fix.isSemVerMajor ? " (мажорное обновление; проверить совместимость)" : ""}`;
  return entry.fix === true ? "Есть исправление; версию уточнить по advisory" : "Не указана в отчёте";
}
function evidence(value, cfg) {
  const entries = value.occurrences || [];
  const descriptions = unique(entries.map((entry) => entry.description || entry.title));
  const fixes = unique(entries.map(safeVersion));
  const rows = unique(entries.map((entry) => {
    const location = (entry.nodes || []).join(", ") || entry.target || entry.entry || "Не указана";
    return `| ${text(entry.package || entry.entry || "Не указан")} | ${text(entry.installed || "Не указана в отчёте")} | ${text(entry.range || "Не указан в отчёте")} | ${text(location)} |`;
  }));
  return [
    `- **Проект / Сервис:** ${text(cfg.project_path)}`,
    `- **Источники проверки:** ${text(unique(value.sources || []).join(", "))}`,
    ...descriptions.map((description) => `\n> ${text(description)}`),
    "",
    "| Компонент | Текущая версия | Уязвимый диапазон | Локализация |",
    "| --- | --- | --- | --- |",
    ...rows,
    "",
    "| Свойство | Значение |",
    "| --- | --- |",
    `| Рекомендуемая безопасная версия | ${fixes.join("; ") || "Не указана в отчёте"} |`,
    ...references(value),
    "",
    `**Pipeline проверки:** ${link(cfg.pipeline_url) || "Не указан"}`,
  ].join("\n");
}
const checklist = [
  "## Необходимо",
  "",
  "- [ ] Исправить код или обновить зависимость / runtime-образ до безопасной версии.",
  "- [ ] Провести тестирование проекта и проверить совместимость изменений.",
  "- [ ] Запустить повторную проверку production-зависимостей (`npm audit --omit=dev`) и runtime-образа; убедиться, что уязвимость устранена.",
  "- [ ] Дождаться успешных проверок CI в MR.",
].join("\n");
function projectText(value, cfg, severity) {
  return [
    `<!-- nightly-security project=${cfg.project_id} -->`,
    "",
    "## Общая информация",
    "",
    `- **Уязвимость:** ${text(value.id)}`,
    `- **Уровень:** ${text(severity)}`,
    `- **Проблемный компонент:** ${packages(value).map(text).join(", ") || "Не указан в отчёте"}`,
    "",
    "## Описание и локализация уязвимости",
    "",
    evidence(value, cfg),
    "",
    checklist,
  ].join("\n");
}
function parentText(value, cfg, parent, severity) {
  const blocks = new Map();
  // Keep each repository's evidence when another repository updates a shared CVE.
  const pattern = /<!-- nightly-security evidence project=(\d+) packages=([^\s>]*) -->\n([\s\S]*?)\n<!-- \/nightly-security evidence -->/g;
  for (const match of (parent.description || "").matchAll(pattern)) {
    try { blocks.set(match[1], { packages: decodeURIComponent(match[2]).split("\n"), body: match[3] }); }
    catch { throw new Error("Cannot decode existing shared CVE evidence"); }
  }
  blocks.set(String(cfg.project_id), {
    packages: packages(value),
    body: `### ${text(cfg.project_path)}\n\n${evidence(value, cfg)}`,
  });
  const allPackages = unique([...blocks.values()].flatMap((block) => block.packages));
  const sections = [...blocks].sort(([a], [b]) => a.localeCompare(b)).map(([id, block]) => [
    `<!-- nightly-security evidence project=${id} packages=${encodeURIComponent(block.packages.join("\n"))} -->`,
    block.body,
    "<!-- /nightly-security evidence -->",
  ].join("\n"));
  return {
    packages: allPackages,
    description: [
      "<!-- nightly-security parent -->", "", "## Общая информация", "",
      `- **Уязвимость:** ${text(value.id)}`,
      `- **Уровень:** ${text(severity)}`,
      `- **Проблемные компоненты:** ${allPackages.map(text).join(", ") || "Не указаны в отчёте"}`,
      "", "## Описание и локализация уязвимости", "", ...sections, "", checklist,
    ].join("\n"),
  };
}
module.exports = { packages, projectText, parentText };

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
// A nonempty paragraph keeps YouTrack from visually joining adjacent tables.
const tableSpacing = (body) => body.replace(/(\|[^\r\n]*\|)\r?\n(?:[ \t]*\r?\n)+(?=\|)/g, "$1\n\n&nbsp;\n\n");
function repairLinks(description = "") {
  return description.match(/<!-- nightly-security merge-requests -->[\s\S]*?<!-- \/nightly-security merge-requests -->/)?.[0] || "";
}
function projectText(value, cfg, severity, previous = "") {
  return tableSpacing([
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
    ...(repairLinks(previous) ? ["", repairLinks(previous)] : []),
  ].join("\n"));
}
// Shared CVE facts must not contain installed versions, repository locations or
// pipelines. Affected repositories are represented only by child issue links.
function commonEvidence(value) {
  const entries = value.occurrences || [];
  const rows = unique(entries.map((entry) =>
    `| ${text(entry.package || entry.entry || "Не указан")} | ${text(entry.range || "Не указан в отчёте")} |`,
  ));
  return [
    ...unique(entries.map((entry) => entry.description || entry.title)).map((description) => `> ${text(description)}`),
    "", "| Компонент | Уязвимый диапазон |", "| --- | --- |", ...rows,
    "", "| Свойство | Значение |", "| --- | --- |",
    `| Рекомендуемая безопасная версия | ${unique(entries.map(safeVersion)).join("; ") || "Не указана в отчёте"} |`,
    ...references(value),
  ].join("\n");
}
function legacyCommonEvidence(body) {
  const lines = body.split(/\r?\n/), rows = [];
  let components = false;
  for (const line of lines) {
    if (line.startsWith("| Компонент |")) { components = true; continue; }
    if (components && !line.startsWith("|")) components = false;
    if (components && !line.startsWith("| ---")) {
      const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
      if (cells.length === 4) rows.push(`| ${cells[0]} | ${cells[2]} |`);
    }
  }
  return [
    ...lines.filter((line) => line.startsWith("> ")),
    "", "| Компонент | Уязвимый диапазон |", "| --- | --- |", ...rows,
    "", "| Свойство | Значение |", "| --- | --- |",
    ...lines.filter((line) => /^\| (?:Рекомендуемая безопасная версия|Ссылка на NVD|Ссылка на GitHub|Источники) \|/.test(line)),
  ].join("\n");
}
function parentText(value, parent, severity) {
  const blocks = new Map();
  const add = (encoded, body) => {
    let names;
    try { names = unique(decodeURIComponent(encoded).split("\n")); }
    catch { throw new Error("Cannot decode existing shared CVE evidence"); }
    blocks.set(names.join("\n"), { packages: names, body });
  };
  const oldPattern = /<!-- nightly-security evidence project=\d+ packages=([^\s>]*) -->\r?\n([\s\S]*?)\r?\n<!-- \/nightly-security evidence -->/g;
  for (const match of (parent.description || "").matchAll(oldPattern))
    add(match[1], legacyCommonEvidence(match[2]));
  const pattern = /<!-- nightly-security advisory packages=([^\s>]*) -->\r?\n([\s\S]*?)\r?\n<!-- \/nightly-security advisory -->/g;
  for (const match of (parent.description || "").matchAll(pattern)) add(match[1], match[2]);
  const names = packages(value);
  blocks.set(names.join("\n"), { packages: names, body: commonEvidence(value) });
  const allPackages = unique([...blocks.values()].flatMap((block) => block.packages));
  const sections = [...blocks].sort(([a], [b]) => a.localeCompare(b)).map(([, block]) => [
    `<!-- nightly-security advisory packages=${encodeURIComponent(block.packages.join("\n"))} -->`,
    block.body,
    "<!-- /nightly-security advisory -->",
  ].join("\n"));
  return {
    packages: allPackages,
    description: tableSpacing([
      "<!-- nightly-security parent -->", "", "## Общая информация", "",
      `- **Уязвимость:** ${text(value.id)}`,
      `- **Уровень:** ${text(severity)}`,
      `- **Проблемные компоненты:** ${allPackages.map(text).join(", ") || "Не указаны в отчёте"}`,
      "", "## Описание уязвимости", "", ...sections,
      "", "## Необходимо", "",
      "- [ ] Устранить уязвимость во всех затронутых проектах, перечисленных в дочерних задачах.",
      "- [ ] Подтвердить устранение повторными проверками и завершить дочерние задачи.",
    ].join("\n")),
  };
}
module.exports = { repairLinks, packages, projectText, parentText };

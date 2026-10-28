const { ensure } = require("../automation");
function formatReport(report) {
  const cfg = report.config,
    lines = [
      `🛡️ **${cfg.project_path}** · [ночная проверка](${cfg.pipeline_url})`,
    ];
  for (const value of report.findings) {
    lines.push(
      "",
      `**${value.severity} · ${value.id}** (${value.sources.join(", ")})`,
    );
    const packages = [
      ...new Set(
        value.occurrences.map((entry) => entry.package || "").filter(Boolean),
      ),
    ].sort();
    if (packages.length)
      lines.push(
        "Компоненты: " +
          packages.map((name) => name.replace(/`/g, "")).join(", "),
      );
    for (const [field, label] of [
      ["parent", "CVE"],
      ["task", "Исправление"],
    ])
      if (value[field])
        lines.push(`${label}: [${value[field].key}](${value[field].url})`);
    const repair = value.repair || {};
    if (repair.mr)
      lines.push(
        `MR: ${repair.mr} · ` +
          (repair.status === "verified" ? "проверки пройдены" : "уже открыт"),
      );
    if (repair.reason) lines.push("Ожидает исправления: " + repair.reason);
    if (value.tracking_error)
      lines.push("Ошибка YouTrack: " + value.tracking_error);
  }
  if (report.errors.length)
    lines.push(
      "",
      "⚠️ Проверка завершена не полностью:",
      ...report.errors.map((error) => "• " + error),
    );
  else if (!report.findings.length)
    lines.push("", "HIGH/CRITICAL не обнаружены.");
  return lines.join("\n");
}
function messageParts(message) {
  const parts = [];
  let current = "";
  for (const section of message.split("\n\n")) {
    ensure(
      [...section].length <= 10000,
      "Report section exceeds Mattermost message budget",
    );
    if (current && [...current].length + [...section].length + 2 > 10000) {
      parts.push(current);
      current = "";
    }
    current += (current ? "\n\n" : "") + section;
  }
  if (current) parts.push(current);
  return parts;
}
module.exports = { formatReport, messageParts };

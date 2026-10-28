const { ensure, stable } = require("../automation");
const { API } = require("./runtime");
const HIGH = new Set(["HIGH", "CRITICAL"]);
const ID_SOURCE =
  "(?:CVE-\\d{4}-\\d{4,}|GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}|NPM-\\d+|NSWG-COR-\\d+)";
const identifier = new RegExp("^" + ID_SOURCE + "(?![\\s\\S])", "i");
const ids = (text) =>
  typeof text === "string" ? text.match(new RegExp(ID_SOURCE, "gi")) || [] : [];
const intersects = (a, b) => {
  const set = new Set(b);
  return a.some((value) => set.has(value));
};
function canonical(aliases) {
  const values = [
    ...new Set(
      aliases
        .filter((value) => typeof value === "string" && identifier.test(value))
        .map((value) => value.toUpperCase()),
    ),
  ].sort();
  ensure(values.length, "Advisory has no stable CVE/GHSA/npm identifier");
  return [
    values.find((value) => value.startsWith("CVE-")) || values[0],
    values,
  ];
}
function finding(aliases, severity, source, occurrence, extra = {}) {
  const [id, values] = canonical(aliases);
  return {
    id,
    aliases: values,
    severity: severity.toUpperCase(),
    sources: [source],
    occurrences: [occurrence],
    ...extra,
  };
}
function mergeFindings(values) {
  let result = [];
  for (const value of values) {
    const matches = result.filter((old) =>
        intersects(old.aliases, value.aliases),
      ),
      combined = structuredClone(value);
    for (const old of matches) {
      result = result.filter((item) => item !== old);
      combined.aliases.push(...old.aliases);
      combined.sources.push(...old.sources);
      combined.occurrences.push(...old.occurrences);
      if (old.severity === "CRITICAL") combined.severity = "CRITICAL";
    }
    [combined.id, combined.aliases] = canonical(combined.aliases);
    combined.sources = [...new Set(combined.sources)].sort();
    combined.occurrences = [
      ...new Map(
        combined.occurrences.map((entry) => [stable(entry), entry]),
      ).values(),
    ];
    result.push(combined);
  }
  return result.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
async function osvAliases(identifier) {
  if (identifier.toUpperCase().startsWith("GHSA-")) {
    const data = await new API("https://api.osv.dev/v1").get(
      "vulns/" + identifier,
    );
    return [identifier, ...(data.aliases || [])];
  }
  return [identifier];
}
async function npmFindings(report, aliases = osvAliases) {
  ensure(
    report &&
      report.vulnerabilities &&
      typeof report.vulnerabilities === "object" &&
      !Array.isArray(report.vulnerabilities) &&
      !report.error,
    "npm audit did not return a valid report",
  );
  const result = [];
  for (const [pkg, entry] of Object.entries(report.vulnerabilities))
    for (const advisory of entry.via || []) {
      if (
        !advisory ||
        typeof advisory !== "object" ||
        !HIGH.has((advisory.severity || "").toUpperCase())
      )
        continue;
      let identifiers = ids(advisory.url || "");
      if (!identifiers.length) {
        ensure(
          Number.isInteger(advisory.source),
          "npm advisory has no identity",
        );
        identifiers = ["NPM-" + advisory.source];
      }
      const expanded = (
        await Promise.all(identifiers.map((key) => aliases(key)))
      ).flat();
      result.push(
        finding(expanded, advisory.severity, "npm", {
          package: advisory.name || pkg,
          entry: pkg,
          nodes: entry.nodes || [],
          range: advisory.range || "",
          fix: entry.fixAvailable ?? false,
          url: advisory.url || "",
        }),
      );
    }
  return mergeFindings(result);
}
function trivyFindings(report) {
  ensure(
    report?.SchemaVersion === 2 && Array.isArray(report.Results || []),
    "Invalid Trivy report",
  );
  const result = [];
  for (const target of report.Results || [])
    for (const item of target.Vulnerabilities || [])
      if (HIGH.has(item.Severity))
        result.push(
          finding([item.VulnerabilityID], item.Severity, "runtime", {
            package: item.PkgName,
            installed: item.InstalledVersion || "",
            fixed: item.FixedVersion || "",
            target: target.Target || "",
            url: item.PrimaryURL || "",
          }),
        );
  return mergeFindings(result);
}
function nodeFindings(version, feed) {
  const semver = require("semver"),
    result = [];
  ensure(
    feed && typeof feed === "object" && !Array.isArray(feed),
    "Invalid Node feed",
  );
  for (const [key, value] of Object.entries(feed)) {
    ensure(
      value &&
        typeof value.vulnerable === "string" &&
        typeof value.patched === "string",
      "Invalid Node feed",
    );
    if (
      !semver.satisfies(version, value.vulnerable) ||
      semver.satisfies(version, value.patched) ||
      (value.affectedEnvironments &&
        !value.affectedEnvironments.some((x) => ["all", "linux"].includes(x)))
    )
      continue;
    if (!HIGH.has((value.severity || "").toUpperCase())) continue;
    for (const id of value.cve?.length ? value.cve : ["NSWG-COR-" + key])
      result.push(
        finding([id], value.severity, "node", {
          package: "node",
          installed: version,
          fixed: value.patched,
          url: value.ref || "",
        }),
      );
  }
  return result;
}
module.exports = {
  HIGH,
  ids,
  identifier,
  intersects,
  canonical,
  finding,
  mergeFindings,
  osvAliases,
  npmFindings,
  trivyFindings,
  nodeFindings,
};

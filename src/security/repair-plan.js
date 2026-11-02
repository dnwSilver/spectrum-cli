const { path, read, sha, stable, ensure, COMMIT } = require("../automation");
const { intersects } = require("./findings");
const unique = (items) => [...new Set(items)].sort();
const PREFIX = "<!-- spectrum-security-group:";

function rootsFor(entry, manifest, lock) {
  const direct = Object.keys({ ...manifest.dependencies, ...manifest.optionalDependencies });
  if (entry.fix && direct.includes(entry.fix.name)) return [entry.fix.name];
  if (direct.includes(entry.entry)) return [entry.entry];
  if (direct.includes(entry.package)) return [entry.package];
  const packages = lock.packages || {};
  const targets = new Set((entry.nodes || []).map((node) => node.replace(/\\/g, "/")));
  function resolve(parent, name) {
    let cursor = parent;
    for (;;) {
      const location = (cursor ? cursor + "/" : "") + "node_modules/" + name;
      if (packages[location]) return location;
      if (!cursor) return null;
      const at = cursor.lastIndexOf("/node_modules/");
      cursor = at < 0 ? "" : cursor.slice(0, at);
    }
  }
  const roots = direct.filter((name) => {
    const pending = [resolve("", name)], visited = new Set();
    while (pending.length) {
      const location = pending.pop();
      if (!location || visited.has(location)) continue;
      visited.add(location);
      if (targets.has(location)) return true;
      const pkg = packages[location];
      for (const dependency of Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies }))
        pending.push(resolve(location, dependency));
    }
    return false;
  });
  if (roots.length) return roots;
  // Older lockfiles may not provide a dependency graph. A leaf still forms one
  // stable repair group; fixNpm permits a manifest change only for a direct dep.
  return [entry.entry || entry.package];
}

function planRepairs(findings, root, runtime = {}) {
  let manifest = {}, lock = {};
  if (findings.some((item) => item.sources.includes("npm"))) {
    manifest = read(path.join(root, "package.json"));
    lock = read(path.join(root, "package-lock.json"));
  }
  const groups = [];
  for (const value of findings) {
    const keys = [];
    if (value.sources.includes("npm")) {
      for (const entry of value.occurrences.filter((item) => Object.hasOwn(item, "entry")))
        for (const name of rootsFor(entry, manifest, lock)) {
          ensure(typeof name === "string" && name, "Cannot determine npm repair group");
          keys.push("npm:" + name);
        }
      ensure(keys.length, "npm finding has no package evidence");
    }
    if (intersects(value.sources, ["runtime", "node"])) keys.push("runtime:" + (runtime.dockerfile || "Dockerfile"));
    ensure(keys.length, "Finding has no supported repair source");
    const matches = groups.filter((group) => intersects(group.keys, keys));
    const merged = { keys: unique(keys.concat(...matches.map((group) => group.keys))), findings: [value, ...matches.flatMap((group) => group.findings)] };
    for (const match of matches) groups.splice(groups.indexOf(match), 1);
    groups.push(merged);
  }
  return groups.map((group) => {
    const members = group.findings.sort((a, b) => (a.task?.key || a.id).localeCompare(b.task?.key || b.id, "en"));
    const id = sha(stable(group.keys)).slice(0, 16);
    return {
      ...members[0],
      aliases: unique(members.flatMap((item) => item.aliases)),
      sources: unique(members.flatMap((item) => item.sources)),
      severity: members.some((item) => item.severity === "CRITICAL") ? "CRITICAL" : "HIGH",
      occurrences: [...new Map(members.flatMap((item) => item.occurrences).map((entry) => [stable(entry), entry])).values()],
      members,
      group: { id, keys: group.keys, label: group.keys.join(", ") },
    };
  }).sort((a, b) => a.group.id.localeCompare(b.group.id));
}

function groupState(description = "") {
  const matches = [...(description || "").matchAll(/<!-- spectrum-security-group:([a-f0-9]{16}) ([A-Za-z0-9+/=]+) -->/g)];
  if (!matches.length) return null;
  ensure(matches.length === 1, "Ambiguous repair group metadata");
  const state = JSON.parse(Buffer.from(matches[0][2], "base64").toString("utf8"));
  ensure(state.schema === 1 && state.id === matches[0][1] && Array.isArray(state.keys) && state.keys.every((key) => typeof key === "string") && state.files && typeof state.files === "object" && !Array.isArray(state.files) && Object.values(state.files).every((hash) => /^[a-f0-9]{64}$/.test(hash)) && COMMIT.test(state.head) && COMMIT.test(state.base), "Invalid repair group metadata");
  return state;
}
function stateMarker(state) {
  return PREFIX + state.id + " " + Buffer.from(JSON.stringify(state)).toString("base64") + " -->";
}
function fileHashes(actions) {
  return Object.fromEntries(actions.map((action) => [
    action.file_path,
    sha(Buffer.from(action.content, action.encoding === "base64" ? "base64" : "utf8")),
  ]));
}
module.exports = { planRepairs, rootsFor, groupState, stateMarker, fileHashes };

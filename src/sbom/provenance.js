// Parse a deliberately bounded subset of Next's build recipes. Never eval code.
const { ensure, safePath, sha, SEMVER, json, equal } = require("../automation");
const { purl } = require("./schema");
class Unresolved extends Error {}
const reject = (message) => {
  throw new Unresolved(message);
};
const check = (condition, message) => {
  if (!condition) reject(message);
};
const packageRoot = (request) =>
  request.startsWith("@")
    ? request.split("/").slice(0, 2).join("/")
    : request.split("/")[0];
function nccOptions(text) {
  check(text.length <= 8192, "ncc options limit exceeded");
  const token =
    /\s+|\/\/[^\n]*|\/\*.*?\*\/|'[^'\\\r\n]*'|"[^"\\\r\n]*"|\.\.\.|[A-Za-z_$][\w$]*|[{},:]/gsy;
  const tokens = [];
  let position = 0;
  while (position < text.length) {
    token.lastIndex = position;
    const match = token.exec(text);
    check(match, "unsupported ncc expression");
    position = token.lastIndex;
    if (
      !/^\s+(?![\s\S])/.test(match[0]) &&
      !match[0].startsWith("//") &&
      !match[0].startsWith("/*")
    )
      tokens.push(match[0]);
  }
  check(tokens.length <= 512, "ncc options limit exceeded");
  position = 0;
  const take = () => {
    check(position < tokens.length, "incomplete ncc options");
    return tokens[position++];
  };
  const expect = (expected) =>
    check(take() === expected, "unsupported ncc options");
  const key = (value) => {
    if (/^["']/.test(value)) return value.slice(1, -1);
    check(
      /^[A-Za-z_$][\w$]*(?![\s\S])/.test(value),
      "unsupported ncc property",
    );
    return value;
  };
  const literal = (value) => {
    check(/^["']/.test(value), "ncc string literal required");
    return value.slice(1, -1);
  };
  function externalMap() {
    expect("...");
    expect("externals");
    const mappings = {};
    while (true) {
      const separator = take();
      if (separator === "}") return mappings;
      check(separator === ",", "unsupported externals object");
      const item = take();
      if (item === "}") return mappings;
      const name = key(item);
      check(
        !Object.hasOwn(mappings, name) &&
          !["__proto__", "constructor", "prototype"].includes(name),
        "duplicate or unsafe external key",
      );
      expect(":");
      const destination = literal(take());
      check(
        /^(?:@[A-Za-z0-9_.-]+\/)?[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*(?![\s\S])/.test(
          name,
        ),
        "unsupported external request",
      );
      check(
        /^next\/dist\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*(?![\s\S])/.test(
          destination,
        ),
        "unsupported external destination",
      );
      check(safePath(name) && safePath(destination), "unsafe external path");
      mappings[name] = destination;
    }
  }
  const options = {};
  while (position < tokens.length) {
    const nameToken = take(),
      name = key(nameToken);
    check(
      !Object.hasOwn(options, name) &&
        ["packageName", "bundleName", "externals", "target"].includes(name),
      "duplicate or unsupported ncc option",
    );
    let value;
    if (
      name === "externals" &&
      (position === tokens.length || tokens[position] === ",")
    ) {
      check(nameToken === "externals", "unsupported quoted shorthand");
      value = {};
    } else {
      expect(":");
      value = take();
      if (name === "externals") {
        if (value === "{") value = externalMap();
        else {
          check(value === "externals", "unsupported externals value");
          value = {};
        }
      } else value = literal(value);
    }
    options[name] = value;
    if (position < tokens.length) expect(",");
  }
  return options;
}
const escaped = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function recipeDetails(taskfile, target, manifestName) {
  const functions = taskfile.split(/^(?=export (?:async )?function )/m);
  const matcher = new RegExp(
    "\\.target\\(\\s*['\"]" + escaped(target) + "['\"]\\s*\\)",
  );
  const candidates = functions.filter((fn) => matcher.test(fn));
  check(candidates.length === 1, "no unique supported build recipe");
  let fn = candidates[0];
  check(
    !/\.(?:run|replace|writeFile|copyFile|rename)\s*\(|\bfs\.|\bpatch\b/.test(
      fn,
    ),
    "patched or custom build recipe",
  );
  fn = fn.split("\n}", 1)[0] + "\n}";
  check(fn.length <= 16384, "recipe size limit exceeded");
  const clean = fn.replace(
    /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\/\*.*?\*\/|\/\/[^\n]*/gs,
    (value) => (value.startsWith("/*") || value.startsWith("//") ? " " : value),
  );
  const shape =
    /^export async function \w+\(\s*task\s*,\s*opts\s*\)\s*\{\s*await\s+task\s*\.source\(\s*relative\(\s*__dirname\s*,\s*require\.resolve\(\s*(['"])([^'"\\\r\n]+)\1\s*\)\s*\)\s*\)\s*\.ncc\(\s*\{(.*?)\}\s*\)\s*\.target\(\s*(['"])([^'"\\\r\n]+)\4\s*\)\s*;?\s*\}(?![\s\S])/s;
  const match = clean.trim().match(shape);
  check(match, "unsupported recipe operations");
  const options = nccOptions(match[3]),
    source = match[2];
  check(
    options.packageName === manifestName && match[5] === target,
    "unsupported recipe identity",
  );
  check(
    /^(?:@[A-Za-z0-9_.-]+\/)?[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*(?![\s\S])/.test(
      source,
    ) && safePath(source),
    "unsafe recipe source",
  );
  const mappings = options.externals || {};
  check(
    !Object.keys(mappings).some((name) =>
      [packageRoot(source), manifestName].includes(packageRoot(name)),
    ),
    "recipe externalizes its own source package",
  );
  return { request: packageRoot(source), externals: mappings, sha256: sha(fn) };
}
function npmSpec(name, spec) {
  check(
    typeof spec === "string" &&
      !/git|github:|https?:|file:|link:|workspace:|patch:/.test(spec),
    "non-registry or patched dependency",
  );
  if (spec.startsWith("npm:")) {
    const match = spec.match(/^npm:((?:@[^/]+\/)?[^@]+)@(.+)(?![\s\S])/);
    check(match, "unsupported npm alias");
    return [match[1], match[2]];
  }
  return [name, spec];
}
function exactResolution(name, spec, locator) {
  const [actual, requested] = npmSpec(name, spec);
  check(
    typeof locator === "string" && !/patch|github|http/.test(locator),
    "patched or non-registry resolution",
  );
  let value = locator.replace(/^\/+/, "");
  for (const prefix of [actual + "@", actual + "/"])
    if (value.startsWith(prefix)) {
      value = value.slice(prefix.length);
      break;
    }
  const version = value.split("(")[0].split("_")[0];
  check(SEMVER.test(version), "resolution is not an exact npm version");
  check(
    !SEMVER.test(requested) || version === requested,
    "manifest/lock exact version mismatch",
  );
  return [actual, version];
}
function registryIntegrity(lock, name, version) {
  const candidates = [];
  for (const [key, entry] of Object.entries(lock.packages || {})) {
    let identity;
    try {
      identity = exactResolution(name, version, key);
    } catch (error) {
      if (error instanceof Unresolved) continue;
      throw error;
    }
    if (
      equal(identity, [name, version]) &&
      entry &&
      typeof entry === "object"
    ) {
      const resolution = entry.resolution || {};
      check(
        resolution && typeof resolution === "object",
        "unsupported pnpm package resolution",
      );
      if (resolution.tarball) {
        const url = new URL(resolution.tarball);
        check(
          url.protocol === "https:" && url.hostname === "registry.npmjs.org",
          "non-registry pnpm tarball",
        );
      }
      candidates.push(resolution.integrity);
    }
  }
  check(
    candidates.length &&
      new Set(candidates).size === 1 &&
      typeof candidates[0] === "string",
    "no unique historical package integrity",
  );
  return candidates[0];
}
function lockResolution(git, commit, name) {
  const manifests = {};
  for (const [importer, file] of [
    ["packages/next", "packages/next/package.json"],
    [".", "package.json"],
  ]) {
    const raw = git.show(commit, file);
    if (raw) {
      const manifest = json(raw),
        values = ["dependencies", "devDependencies", "optionalDependencies"]
          .filter((k) => Object.hasOwn(manifest[k] || {}, name))
          .map((k) => manifest[k][name]);
      check(new Set(values).size <= 1, "ambiguous dependency manifest");
      if (values.length) manifests[importer] = values[0];
    }
  }
  check(
    Object.keys(manifests).length,
    "build dependency absent from historical manifests",
  );
  const importer = Object.hasOwn(manifests, "packages/next")
      ? "packages/next"
      : ".",
    spec = manifests[importer];
  const [actual] = npmSpec(name, spec);
  const raw = git.show(commit, "pnpm-lock.yaml");
  if (raw) {
    const YAML = require("yaml");
    const lock = YAML.parse(String(raw), {
      maxAliasCount: 100,
      uniqueKeys: true,
    });
    check(lock && typeof lock === "object", "invalid pnpm lockfile");
    check(
      !Object.keys(lock.patchedDependencies || {}).some(
        (key) => key === actual || key.startsWith(actual + "@"),
      ),
      "historical pnpm patch",
    );
    const selected = lock.importers?.[importer] || {},
      values = ["dependencies", "devDependencies", "optionalDependencies"]
        .filter((k) => Object.hasOwn(selected[k] || {}, name))
        .map((k) => selected[k][name]);
    check(values.length === 1, "no unique historical pnpm importer resolution");
    let value = values[0];
    if (value && typeof value === "object") {
      check(value.specifier === spec, "historical pnpm specifier mismatch");
      value = value.version;
    } else
      check(
        selected.specifiers?.[name] === spec,
        "historical pnpm specifier mismatch",
      );
    const [resolved, version] = exactResolution(name, spec, value);
    return [
      resolved,
      version,
      "pnpm-lock.yaml",
      {
        locator: String(value),
        integrity: registryIntegrity(lock, resolved, version),
      },
    ];
  }
  const yarn = git.show(commit, "yarn.lock");
  check(yarn, "no supported historical lockfile");
  const wanted = name + "@" + spec,
    matches = [];
  for (const block of String(yarn).split(/\n(?=\S)/)) {
    const rows = block.split("\n");
    if (!rows[0].endsWith(":") || rows[0].startsWith("#")) continue;
    const keys = rows[0]
      .slice(0, -1)
      .split(", ")
      .map((key) => key.trim().replace(/^["']|["'](?![\s\S])/g, ""));
    if (!keys.includes(wanted)) continue;
    const version = block.match(/^  version "([^"\n]+)"$/m),
      source = block.match(/^  resolved "([^"\n]+)"$/m),
      integrity = block.match(/^  integrity ([^\s]+)$/m);
    if (
      version &&
      source &&
      /^https:\/\/registry\.(?:yarnpkg\.com|npmjs\.org)\//.test(source[1])
    ) {
      let digest = integrity
        ? integrity[1].replace(/^"|"(?![\s\S])/g, "")
        : null;
      const fragment = new URL(source[1]).hash.slice(1);
      if (!digest && /^[a-f0-9]{40}(?![\s\S])/.test(fragment))
        digest = "sha1-" + Buffer.from(fragment, "hex").toString("base64");
      if (digest) matches.push([version[1], source[1], digest]);
    }
  }
  check(matches.length === 1, "no unique registry-backed yarn resolution");
  const [resolved, version] = exactResolution(name, spec, matches[0][0]);
  return [
    resolved,
    version,
    "yarn.lock",
    { locator: matches[0][1], integrity: matches[0][2] },
  ];
}
function compiledComponents(files) {
  const manifests = Object.keys(files)
    .filter(
      (p) => p.startsWith("dist/compiled/") && p.endsWith("/package.json"),
    )
    .sort();
  return manifests.flatMap((file) => {
    const manifest = json(files[file]);
    if (![undefined, null, "", "UNKNOWN"].includes(manifest.version)) return [];
    const prefix = file.slice(0, -"/package.json".length);
    const contents = manifests.some(
      (p) => p !== file && p.startsWith(prefix + "/"),
    )
      ? null
      : Object.fromEntries(
          Object.entries(files)
            .filter(([p]) => p.startsWith(prefix + "/"))
            .map(([p, value]) => [p.slice(prefix.length + 1), value]),
        );
    return [[prefix, manifest, contents]];
  });
}
async function resolveComponent(
  git,
  releaseCommit,
  location,
  manifest,
  files,
  verifyRegistry,
) {
  const name = manifest.name;
  check(
    typeof name === "string" && name && files,
    "invalid or nested compiled package",
  );
  const executables = Object.keys(files)
    .filter((p) => /\.(js|cjs|mjs|wasm|node)(?![\s\S])/.test(p))
    .sort();
  check(executables.length, "no executable for provenance");
  const relative = location.slice("dist/".length),
    candidates = ["packages/next/src/" + relative, "packages/next/" + relative];
  const sourcePath = candidates.find((p) =>
    equal(git.tree(releaseCommit, p), files),
  );
  check(sourcePath, "official package differs from release Git tree");
  const representative =
    executables.find((p) => p.endsWith(".js")) || executables[0];
  const code = (values) =>
    Object.fromEntries(
      Object.entries(values).filter(
        ([p]) =>
          !["package.json", "LICENSE", "LICENSE.md", "LICENSE.txt"].includes(p),
      ),
    );
  for (const [commit, filename] of git.history(
    releaseCommit,
    sourcePath + "/" + representative,
  )) {
    if (!filename.endsWith("/" + representative)) continue;
    const historicalPath = filename.slice(0, -representative.length - 1),
      tree = git.tree(commit, historicalPath);
    if (!equal(code(tree), code(files))) continue;
    const parents = String(git.call("rev-list", "--parents", "-n", "1", commit))
      .trim()
      .split(/\s+/)
      .slice(1);
    if (parents.length !== 1) continue;
    const previous = git.show(parents[0], filename);
    if (previous && previous.equals(files[representative])) continue;
    const taskfile = git.show(commit, "packages/next/taskfile.js");
    if (!taskfile) continue;
    const recipe = recipeDetails(
      String(taskfile),
      historicalPath.slice("packages/next/".length),
      name,
    );
    const [resolvedName, version, lockfile, resolution] = lockResolution(
      git,
      commit,
      recipe.request,
    );
    check(
      resolvedName === name,
      "compiled manifest differs from resolved npm package",
    );
    await verifyRegistry(resolvedName, version, resolution);
    const resolutionText = JSON.stringify(
      Object.fromEntries(Object.entries(resolution).sort()),
      null,
      0,
    )
      .replace(/":/g, '": ')
      .replace(/,"/g, ', "');
    return {
      path: location,
      name,
      version,
      purl: purl(name, version),
      files: Object.fromEntries(
        Object.keys(files)
          .sort()
          .map((p) => [p, sha(files[p])]),
      ),
      evidence: {
        commit,
        sourcePath: historicalPath,
        lockfile,
        resolution: resolutionText,
        recipe: {
          kind: "direct-ncc",
          sha256: recipe.sha256,
          externals: recipe.externals,
        },
      },
    };
  }
  reject("no proven historical rebuild within history limit");
}
module.exports = {
  Unresolved,
  packageRoot,
  nccOptions,
  recipeDetails,
  npmSpec,
  exactResolution,
  registryIntegrity,
  lockResolution,
  compiledComponents,
  resolveComponent,
};

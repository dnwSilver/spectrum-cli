const fs = require("node:fs");
const path = require("node:path");
const { isDryRun, reportPreflight } = require("../cli/command-executor");
function licenses({
  cwd = process.cwd(),
  reportOnly = false,
  dry = isDryRun(),
} = {}) {
  const workspace = fs.realpathSync(cwd);
  const standalone = path.join(workspace, "dist/standalone");
  const result = { copied: 0, existing: 0, withoutLicense: 0, warnings: [] };
  if (dry) result.planned = 0;

  function warn(file, error) {
    result.warnings.push({
      path: path.relative(workspace, file),
      reason: error.message,
    });
  }

  // Reject symlinks at every level; never read or write outside this checkout.
  function checked(file, kind) {
    const relative = path.relative(workspace, file);
    if (
      !relative ||
      relative === ".." ||
      relative.startsWith(".." + path.sep) ||
      path.isAbsolute(relative)
    ) {
      throw new Error("path outside checkout");
    }
    let current = workspace;
    const parts = relative.split(path.sep);
    for (let i = 0; i < parts.length; i++) {
      current = path.join(current, parts[i]);
      const stat = fs.lstatSync(current);
      if (
        stat.isSymbolicLink() ||
        (i < parts.length - 1 && !stat.isDirectory())
      ) {
        throw new Error("unsafe symlink or parent path");
      }
      if (
        i === parts.length - 1 &&
        !(kind === "directory" ? stat.isDirectory() : stat.isFile())
      ) {
        throw new Error("unexpected file type");
      }
    }
    return file;
  }

  function read(file) {
    return fs.readFileSync(checked(file, "file"));
  }

  function identical(left, right) {
    if (!read(left).equals(read(right)))
      throw new Error("source and standalone files differ");
  }

  function files(directory) {
    checked(directory, "directory");
    const found = [];
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) found.push(...files(file));
      else if (entry.isFile()) found.push(checked(file, "file"));
      else throw new Error("non-regular compiled package entry");
    }
    return found;
  }

  function preserve(nextRoot) {
    const sourceRoot = path.join(
      workspace,
      path.relative(standalone, nextRoot),
    );
    const owner = JSON.parse(read(path.join(nextRoot, "package.json")));
    if (
      owner.name !== "next" ||
      typeof owner.version !== "string" ||
      !owner.version
    ) {
      throw new Error("invalid standalone Next identity");
    }
    identical(
      path.join(nextRoot, "package.json"),
      path.join(sourceRoot, "package.json"),
    );
    const compiled = path.join(nextRoot, "dist/compiled");
    const manifests = files(compiled).filter(
      (file) => path.basename(file) === "package.json",
    );
    for (const manifest of manifests) {
      try {
        const target = path.dirname(manifest);
        const source = path.join(sourceRoot, path.relative(nextRoot, target));
        const pkg = JSON.parse(read(manifest));
        if (typeof pkg.name !== "string" || !pkg.name)
          throw new Error("invalid compiled package identity");
        identical(manifest, path.join(source, "package.json"));
        const license = path.join(source, "LICENSE");
        // Some published compiled packages legitimately have no LICENSE file.
        // Validate the parent first so ENOENT cannot hide an unsafe source path.
        checked(source, "directory");
        try {
          checked(license, "file");
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
          result.withoutLicense++;
          continue;
        }
        // No repair of modified code, assets or existing license files.
        for (const file of files(target)) {
          identical(file, path.join(source, path.relative(target, file)));
        }
        const destination = path.join(target, "LICENSE");
        try {
          checked(destination, "file");
          identical(destination, license);
          result.existing++;
          continue;
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
        checked(target, "directory");
        if (dry) result.planned++;
        else {
          fs.copyFileSync(license, destination, fs.constants.COPYFILE_EXCL);
          result.copied++;
        }
      } catch (error) {
        warn(manifest, error);
      }
    }
  }

  function discover(directory) {
    checked(directory, "directory");
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        // Standalone .bin links are not package roots and are never followed.
        if (entry.name === "next" || entry.name === "node_modules")
          warn(file, new Error("symlinked package root"));
        continue;
      }
      if (!entry.isDirectory()) continue;
      if (
        entry.name === "next" &&
        path.basename(directory) === "node_modules"
      ) {
        try {
          preserve(file);
        } catch (error) {
          warn(file, error);
        }
      }
      discover(file);
    }
  }

  try {
    discover(standalone);
  } catch (error) {
    warn(standalone, error);
  }
  if (dry) {
    if (result.warnings.length)
      console.error(
        "Standalone LICENSE preflight: " + JSON.stringify(result.warnings),
      );
    else
      reportPreflight(
        "nextjs licenses",
        "standalone-metadata",
        "проверены исходники, standalone и LICENSE",
      );
  } else
    console.log("Standalone LICENSE preservation: " + JSON.stringify(result));
  return reportOnly ? result : result.warnings.length ? 2 : 0;
}
module.exports = { licenses };

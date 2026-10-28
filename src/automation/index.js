// Shared bounded IO for noninteractive CI commands. Never execute shell strings.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { gunzipSync } = require("node:zlib");
const { isDeepStrictEqual } = require("node:util");

const SEMVER =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?![\s\S])/;
const DIGEST = /^sha256:[a-f0-9]{64}(?![\s\S])/;
const HEX64 = /^[a-f0-9]{64}(?![\s\S])/;
const COMMIT = /^[a-f0-9]{40}(?![\s\S])/;
function ensure(condition, message) {
  if (!condition) throw new Error(message);
}
function sha(data, algorithm = "sha256") {
  return crypto.createHash(algorithm).update(data).digest("hex");
}
function sorted(value) {
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === "object" && !Buffer.isBuffer(value))
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sorted(value[key])]),
    );
  return value;
}
function stable(value) {
  return JSON.stringify(sorted(value));
}
function json(value) {
  try {
    return JSON.parse(Buffer.isBuffer(value) ? value.toString("utf8") : value);
  } catch {
    throw new Error("Invalid JSON data");
  }
}
function read(file) {
  return json(fs.readFileSync(file));
}
function save(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n");
  fs.renameSync(tmp, file);
}
function temp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}
function remove(directory) {
  fs.rmSync(directory, { recursive: true, force: true });
}
async function temporary(prefix, action) {
  const dir = temp(prefix);
  try {
    return await action(dir);
  } finally {
    remove(dir);
  }
}
function safePath(value, absolute = false) {
  return (
    typeof value === "string" &&
    !!value &&
    !/[\\\x00-\x1f]/.test(value) &&
    value.startsWith("/") === absolute &&
    value
      .replace(/^\//, "")
      .split("/")
      .every((part) => part && part !== "." && part !== "..")
  );
}
function repositoryPath(root, relative) {
  ensure(safePath(relative), "Expected a repository-relative path");
  const base = fs.realpathSync(root);
  const target = path.resolve(base, relative);
  let cursor = base;
  for (const part of relative.split("/")) {
    cursor = path.join(cursor, part);
    if (
      fs.existsSync(cursor) ||
      (() => {
        try {
          fs.lstatSync(cursor);
          return true;
        } catch {
          return false;
        }
      })()
    ) {
      const real = fs.realpathSync(cursor);
      ensure(real.startsWith(base + path.sep), "Path leaves repository");
    }
  }
  return target;
}
function exec(
  args,
  {
    cwd,
    env = process.env,
    input,
    allowed = [0],
    timeout = 1800000,
    maxBuffer = 32 * 1024 * 1024,
    binary = false,
    label,
  } = {},
) {
  ensure(
    Array.isArray(args) &&
      args.length &&
      args.every((arg) => typeof arg === "string" && !arg.includes("\0")),
    "Expected command argv",
  );
  const result = spawnSync(args[0], args.slice(1), {
    cwd,
    env,
    input,
    timeout,
    maxBuffer,
    encoding: binary ? null : "utf8",
    windowsHide: true,
  });
  ensure(
    !result.error && allowed.includes(result.status),
    `${label || path.basename(args[0]) + " " + (args[1] || "")} failed (exit ${result.status})`,
  );
  return {
    stdout: result.stdout,
    stderr: result.stderr,
    status: result.status,
  };
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function responseBytes(response, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body || []) {
    size += chunk.length;
    if (size > limit) {
      await response.body?.cancel?.().catch(() => {});
      throw new Error("Download limit exceeded");
    }
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
async function request(
  url,
  {
    method = "GET",
    headers = {},
    body,
    limit = 32 * 1024 * 1024,
    timeout = 60000,
    fetchImpl = fetch,
  } = {},
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetchImpl(url, {
      method,
      headers,
      body,
      redirect: "manual",
      signal: controller.signal,
    });
    const bytes = await responseBytes(response, limit);
    return { status: response.status, headers: response.headers, body: bytes };
  } finally {
    clearTimeout(timer);
  }
}
// Extract data only. No archive entry is ever written to the filesystem.
function tarEntries(
  gzip,
  {
    maxUnpacked = 1024 * 1024 * 1024,
    maxFile = 32 * 1024 * 1024,
    maxEntries = 30000,
  } = {},
) {
  const bytes = gunzipSync(gzip, {
    maxOutputLength: maxUnpacked + maxEntries * 1024,
  });
  const entries = [];
  let offset = 0;
  let total = 0;
  let pax = {};
  let longName;
  const str = (data) => data.toString("utf8").replace(/\0.*(?![\s\S])/s, "");
  while (offset + 512 <= bytes.length) {
    const header = bytes.subarray(offset, offset + 512);
    offset += 512;
    if (header.every((byte) => byte === 0)) break;
    const sizeText = str(header.subarray(124, 136)).trim();
    ensure(/^[0-7]+(?![\s\S])/.test(sizeText), "Invalid tar entry size");
    const size = parseInt(sizeText, 8);
    const expected = parseInt(str(header.subarray(148, 156)).trim(), 8);
    const sum = header.reduce(
      (sum, b, i) => sum + (i >= 148 && i < 156 ? 32 : b),
      0,
    );
    ensure(
      expected === sum && size <= maxFile && offset + size <= bytes.length,
      "Invalid or oversized tar entry",
    );
    const data = bytes.subarray(offset, offset + size);
    offset += Math.ceil(size / 512) * 512;
    const type = String.fromCharCode(header[156] || 48);
    if (type === "x") {
      pax = {};
      let pos = 0;
      while (pos < data.length) {
        const space = data.indexOf(32, pos);
        ensure(space > pos, "Invalid PAX record");
        const len = Number(data.subarray(pos, space).toString());
        ensure(
          Number.isInteger(len) &&
            len > space - pos + 1 &&
            pos + len <= data.length &&
            data[pos + len - 1] === 10,
          "Invalid PAX length",
        );
        const row = data.subarray(space + 1, pos + len - 1).toString();
        const split = row.indexOf("=");
        ensure(split > 0, "Invalid PAX value");
        pax[row.slice(0, split)] = row.slice(split + 1);
        pos += len;
      }
      continue;
    }
    if (type === "L") {
      longName = str(data).replace(/\n(?![\s\S])/, "");
      continue;
    }
    const prefix =
      str(header.subarray(257, 263)) === "ustar"
        ? str(header.subarray(345, 500))
        : "";
    const name =
      pax.path ||
      longName ||
      (prefix ? prefix + "/" : "") + str(header.subarray(0, 100));
    ensure(
      pax.size === undefined || Number(pax.size) === size,
      "Unsupported PAX size",
    );
    pax = {};
    longName = undefined;
    ensure(
      type === "0" || type === "5",
      "Links and special archive entries are forbidden",
    );
    total += size;
    ensure(
      total <= maxUnpacked && entries.length < maxEntries,
      "Archive expansion limit exceeded",
    );
    entries.push({
      name: name.replace(/\/(?![\s\S])/, ""),
      directory: type === "5",
      data,
    });
  }
  return entries;
}
module.exports = {
  fs,
  path,
  SEMVER,
  DIGEST,
  HEX64,
  COMMIT,
  ensure,
  sha,
  stable,
  sorted,
  json,
  read,
  save,
  temp,
  remove,
  temporary,
  safePath,
  repositoryPath,
  exec,
  sleep,
  request,
  tarEntries,
  equal: isDeepStrictEqual,
};

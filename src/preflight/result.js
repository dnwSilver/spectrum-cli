
const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;
const STABLE_SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const YOUTRACK_TASK_PATTERN = /^[A-Z]+-[0-9]+$/;

function ok(data) {
    return { ok: true, data };
}

function fail(reason) {
    return { ok: false, reason };
}

function toPosixPath(filePath) {
    return String(filePath || '').replace(/\\/g, '/');
}

module.exports = { SEMVER_PATTERN, STABLE_SEMVER_PATTERN, YOUTRACK_TASK_PATTERN, ok, fail, toPosixPath };

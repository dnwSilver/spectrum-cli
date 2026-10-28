const { registryAuth } = require("./runtime");
const { Scanner } = require("./scan");
const { Repairer } = require("./repair");
const {
  track: trackFindings,
  reconcile: reconcileFindings,
} = require("./tracking");

function withRegistry(action, options = {}) {
  const env = { ...process.env, ...(options.env || {}) };
  return registryAuth(env, (runtime) => action({ ...options, env: runtime }));
}

function scan(options) {
  return withRegistry(
    ({ env, deps, cwd, dry }) => new Scanner(env, deps).scan(cwd, { dry }),
    options,
  );
}

function track(options) {
  return trackFindings(options);
}

function reconcile(options) {
  return reconcileFindings(options);
}

function repair(options) {
  return withRegistry(
    ({ env, deps, cwd, dry }) => new Repairer(env, deps).repair(cwd, { dry }),
    options,
  );
}

module.exports = { scan, track, reconcile, repair };

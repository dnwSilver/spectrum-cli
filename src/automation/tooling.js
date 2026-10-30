const { identity } = require('../../ci-bootstrap.cjs');
function cliIdentity(env = process.env) {
  return env.SPECTRUM_CLI_IDENTITY ? identity(env.SPECTRUM_CLI_IDENTITY) : undefined;
}
function verifyCLI(report, env = process.env) {
  if (!report.cli) return;
  const current = cliIdentity(env);
  if (JSON.stringify(identity(report.cli)) !== JSON.stringify(current))
    throw Error('CLI identity differs from the scan; use spectrum-ci with the original CLI identity');
}
module.exports = { cliIdentity, verifyCLI };

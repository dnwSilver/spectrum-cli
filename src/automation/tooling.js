const { identity } = require('../../ci-bootstrap.cjs');
function cliIdentity(env = process.env) {
  return env.SPECTRUM_CLI_IDENTITY ? identity(env.SPECTRUM_CLI_IDENTITY) : undefined;
}
module.exports = { cliIdentity };

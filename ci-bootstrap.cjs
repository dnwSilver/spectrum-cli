#!/usr/bin/env node
// Standalone CI launcher. Only Node built-ins: toolbox images keep this file,
// while command implementations are installed independently for every job.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const REPOSITORY = 'dnwSilver/spectrum-cli';
const VERSION = /^\d+(?:\.\d+){0,2}(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?(?![\s\S])/;
const EXACT = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?(?![\s\S])/;
const SHA = /^[a-f0-9]{40}(?![\s\S])/;
const REF = /^[A-Za-z0-9][A-Za-z0-9._/-]*(?![\s\S])/;
function diagnostic(value, env) {
  let text = String(value || '');
  const secrets = Object.entries(env).filter(([key, value]) =>
    /TOKEN|PASSWORD|SECRET|(?:^|_)PAT(?:$|_)|(?:^|_)AUTH(?:ORIZATION)?(?:$|_)/i.test(key) && typeof value === 'string' && value)
    .map(([, value]) => value).sort((a, b) => b.length - a.length);
  for (const secret of secrets) text = text.split(secret).join('[REDACTED]');
  return text.replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/g, '$1[REDACTED]@').replace(/[\r\n]+/g, ' ').slice(0, 2000);
}
function compatible(version) {
  const [major, minor] = version.split('.').map(Number);
  check(major > 6 || (major === 6 && minor >= 2), 'spectrum-ci requires CLI 6.2.0 or newer for frozen pipeline identities');
}
function check(value, message) { if (!value) throw Error(message); }
function identity(value) {
  let data;
  try { data = typeof value === 'string' ? JSON.parse(value) : value; }
  catch { throw Error('Invalid frozen CLI identity JSON'); }
  check(data && data.schemaVersion === 1 && typeof data.version === 'string' && EXACT.test(data.version), 'Invalid frozen CLI identity');
  check(data.source === 'npm' || data.source === 'git', 'Invalid CLI source');
  if (data.source === 'git')
    check(typeof data.ref === 'string' && REF.test(data.ref) && !data.ref.includes('..') &&
      !SHA.test(data.ref) && typeof data.sha === 'string' && SHA.test(data.sha), 'Invalid frozen CLI Git ref/SHA');
  return data.source === 'npm' ? { schemaVersion: 1, source: 'npm', version: data.version } :
    { schemaVersion: 1, source: 'git', ref: data.ref, sha: data.sha, version: data.version };
}
function installEnv(env) {
  const clean = Object.fromEntries(Object.entries(env).filter(([key]) =>
    !/TOKEN|PASSWORD|SECRET|AUTH|NEXUS|MATTERMOST|(?:^|_)PAT(?:$|_)/i.test(key) &&
    !/^(CI_|GLAB_|GITLAB_|YOUTRACK_|GIT_CONFIG_|NPM_CONFIG_|npm_config_)/.test(key) &&
    !['NODE_OPTIONS', 'NODE_PATH'].includes(key)));
  return { ...clean, NPM_CONFIG_USERCONFIG: os.devNull };
}
function runInstaller(command, args, options) {
  // npm.cmd cannot be spawned directly without a shell on Windows.
  if (process.platform === 'win32' && command === 'npm') {
    const candidates = [process.env.npm_execpath,
      path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')];
    const cli = candidates.find(file => file && /npm-cli\.js$/i.test(file) && fs.existsSync(file));
    if (cli) return spawnSync(process.execPath, [cli, ...args], options);
  }
  return spawnSync(command, args, options);
}
class Bootstrap {
  constructor(env = process.env, deps = {}) {
    this.env = env;
    this.fetch = deps.fetch || fetch;
    this.run = deps.run || runInstaller;
    this.child = deps.child || spawnSync;
    this.log = deps.log || console.error;
  }
  command(args, cwd) {
    const result = this.run(args[0], args.slice(1), {
      cwd, encoding: 'utf8', env: installEnv(this.env), timeout: 300000,
    });
    // Installer credentials/configs are stripped; expose only sanitized stderr.
    check(result.status === 0, 'CLI installation failed: ' + args[0] + ' ' + args[1] +
      (result.error?.code ? ' (' + result.error.code + ')' : ' (exit ' + result.status + ')') +
      (result.stderr ? ': ' + diagnostic(result.stderr, this.env) : ''));
    return result.stdout || '';
  }
  async download(url, json = false) {
    let response;
    const headers = { 'User-Agent': 'spectrum-ci' };
    if (new URL(url).hostname === 'api.github.com' && this.env.SPECTRUM_CLI_GITHUB_TOKEN)
      headers.Authorization = 'Bearer ' + this.env.SPECTRUM_CLI_GITHUB_TOKEN;
    try { response = await this.fetch(url, { signal: AbortSignal.timeout(60000), redirect: 'error', headers }); }
    catch { throw Error('CLI source download failed: connection or TLS error'); }
    if (!response.ok) {
      let detail = '';
      try { const data = await response.json(); if (typeof data.message === 'string') detail = ': ' + diagnostic(data.message, this.env); } catch {}
      const error = Error('CLI source download failed (HTTP ' + response.status + ')' + detail);
      error.status = response.status;
      throw error;
    }
    if (json) return response.json();
    const body = Buffer.from(await response.arrayBuffer());
    check(body.length <= 32 * 1024 * 1024, 'CLI source archive is too large');
    return body;
  }
  async resolveRef(ref) {
    const base = 'https://api.github.com/repos/' + REPOSITORY;
    let data, fullRef = 'refs/heads/' + ref;
    try { data = await this.download(base + '/git/ref/heads/' + encodeURIComponent(ref), true); }
    catch (error) {
      if (error.status !== 404) throw error;
      fullRef = 'refs/tags/' + ref;
      data = await this.download(base + '/git/ref/tags/' + encodeURIComponent(ref), true);
    }
    // Do not use /commits/<ref>: it also resolves arbitrary/PR commit IDs.
    check(data.ref === fullRef, 'CLI source is not the requested repository ref');
    let object = data.object;
    for (let hop = 0; object?.type === 'tag' && hop < 4; hop++) {
      check(SHA.test(object.sha), 'Invalid CLI tag object');
      object = (await this.download(base + '/git/tags/' + object.sha, true)).object;
    }
    check(object?.type === 'commit' && typeof object.sha === 'string' && SHA.test(object.sha), 'Invalid CLI repository commit');
    return object.sha;
  }
  async prepare(directory) {
    const e = this.env;
    const file = e.SPECTRUM_CLI_IDENTITY_FILE;
    const fromEnv = e.SPECTRUM_CLI_IDENTITY ? identity(e.SPECTRUM_CLI_IDENTITY) : null;
    const fromFile = file && fs.existsSync(file) ? identity(JSON.parse(fs.readFileSync(file, 'utf8'))) : null;
    if (fromEnv && fromFile) check(JSON.stringify(fromEnv) === JSON.stringify(fromFile), 'Conflicting CLI identities');
    const frozen = fromEnv || fromFile;
    const ref = frozen ? (frozen.source === 'git' ? frozen.ref : '') :
      e.SPECTRUM_CLI_REQUESTED_REF || e.SPECTRUM_CLI_REF || '';
    const version = frozen?.version || e.SPECTRUM_CLI_REQUESTED_VERSION || e.SPECTRUM_CLI_VERSION || '6';
    const cache = path.resolve(e.SPECTRUM_CLI_CACHE_DIR || path.join(process.cwd(), '.spectrum-cli-cache'));
    const npm = ['--engine-strict', '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund',
      '--registry=https://registry.npmjs.org/', '--strict-ssl=true', '--cache', cache];
    let selected, entry;
    if (ref) {
      check(REF.test(ref) && !ref.includes('..') && !SHA.test(ref), 'cli_ref must be a named Git branch or tag');
      const head = await this.resolveRef(ref);
      const sha = frozen?.sha || head;
      if (sha !== head) {
        const compare = await this.download('https://api.github.com/repos/' + REPOSITORY + '/compare/' + sha + '...' + head, true);
        check(compare.merge_base_commit?.sha === sha && ['ahead', 'identical'].includes(compare.status),
          'Frozen CLI commit is no longer on the selected ref; start a new pipeline');
      }
      const archive = path.join(directory, 'source.tar.gz');
      fs.writeFileSync(archive, await this.download('https://codeload.github.com/' + REPOSITORY + '/tar.gz/' + sha));
      const source = path.join(directory, 'source');
      fs.mkdirSync(source);
      const entries = this.command(['tar', '-tzf', archive], directory).trim().split('\n');
      check(entries.length && entries.every(name => name.startsWith('spectrum-cli-' + sha + '/') &&
        !name.includes('\\') && !name.split('/').includes('..')), 'Invalid CLI source archive paths');
      this.command(['tar', '-xzf', archive, '-C', source, '--strip-components=1'], directory);
      check(fs.existsSync(path.join(source, 'package-lock.json')), 'CLI source must include package-lock.json');
      this.command(['npm', 'ci', ...npm], source);
      const pkg = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8'));
      check(pkg.name === 'spectrum-cli' && EXACT.test(pkg.version), 'Invalid CLI source package');
      selected = identity({ schemaVersion: 1, source: 'git', ref, sha, version: pkg.version });
      if (frozen) check(selected.version === frozen.version, 'Frozen CLI package version mismatch');
      entry = path.join(source, 'index.js');
    } else {
      check(VERSION.test(version), 'cli_version must be an npm version, major or minor');
      this.command(['npm', 'install', '--prefix', directory, '--package-lock=false', '--save=false', ...npm,
        'spectrum-cli@' + version], directory);
      const root = path.join(directory, 'node_modules', 'spectrum-cli');
      const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
      check(pkg.name === 'spectrum-cli' && EXACT.test(pkg.version), 'Invalid installed CLI package');
      if (frozen) check(pkg.version === frozen.version, 'Frozen CLI package version mismatch');
      selected = identity({ schemaVersion: 1, source: 'npm', version: pkg.version });
      entry = path.join(root, 'index.js');
    }
    compatible(selected.version);
    check(fs.statSync(entry).isFile(), 'CLI entry point is missing');
    return { selected, entry };
  }
  async execute(args) {
    check(args.length, 'Usage: spectrum-ci <spectrum command and flags>');
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'spectrum-ci-'));
    try {
      const { selected, entry } = await this.prepare(directory);
      this.log('Spectrum CLI: ' + selected.version + (selected.source === 'git' ? ' git ' + selected.ref + '@' + selected.sha : ' npm'));
      const dry = args.some(value => value === '--dry' || /^-[^-]*d/.test(value));
      if (this.env.SPECTRUM_CLI_IDENTITY_FILE && !dry) {
        const file = this.env.SPECTRUM_CLI_IDENTITY_FILE;
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify(selected, null, 2) + '\n');
      }
      const result = this.child(process.execPath, [entry, ...args], {
        stdio: 'inherit', env: { ...this.env, SPECTRUM_CLI_IDENTITY: JSON.stringify(selected) },
      });
      return result.status ?? 1;
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
  }
}
if (require.main === module) {
  const environment = { ...process.env };
  // Legacy application images disable TLS globally. Source downloads still
  // validate TLS; the command child receives the original application env.
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '1';
  new Bootstrap(environment).execute(process.argv.slice(2))
    .then(code => { process.exitCode = code; })
    .catch(error => { console.error('ERROR spectrum-ci: ' + error.message); process.exitCode = 1; });
}
module.exports = { Bootstrap, identity, installEnv, runInstaller };

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, copyFileSync, writeFileSync, lstatSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const SOURCE = '71c50bb5feb7b5dbc5b621c2e8153693d6fc8807';
export const TREE = '8b6da97c597ce49ac63dfb0de4dc6d8353b1c826';
export const VERSION = '1.0.73';
export const REPO = 'nic21vdw/colateral-releases';
export const KEY = 'dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDc0MjlFNTgyMjA0MDgzQQpSV1E2Q0FRaVdKNUNCMDc4c2k5Z3RMSFd3VmFjQndOR2JGVTBRd3ExajhSeDBRN1VFNkYram1hZwo=';
export const INSTALLER = `CoLateral_${VERSION}_x64-setup.exe`;
export const SIGNATURE = INSTALLER + '.sig';
export const CARGO_MANIFEST = 'apps/desktop/src-tauri/Cargo.toml';
export const MARKER = `Frozen source: ${SOURCE}\nFrozen tree: ${TREE}\nCloud rebuild; original NicPC installer was not used.`;
const root = resolve('candidate'), stage = resolve('preview-assets');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = file => JSON.parse(readFileSync(file, 'utf8'));
const gitBytes = args => execFileSync('git', ['-c', 'core.fsmonitor=false', ...args], { cwd: root, timeout: 15000 });
const git = args => gitBytes(args).toString('utf8').trimEnd();
const write = (name, value) => writeFileSync(join(stage, name), JSON.stringify(value, null, 2) + '\n');
const runUrl = () => `https://github.com/${REPO}/actions/runs/${process.env.GITHUB_RUN_ID}`;

export function assertCandidate(facts) {
  const mismatches = [['source', SOURCE], ['tree', TREE], ['version', VERSION], ['cargoVersion', VERSION], ['key', KEY]]
    .filter(([name, expected]) => facts[name] !== expected).map(([name]) => name);
  if (facts.dirty) mismatches.push('tracked state');
  if (mismatches.length) {
    // Report field names and Git paths/status only. Never dump private source,
    // configuration contents, keys, or environment values into public CI logs.
    const changes = facts.dirty && facts.trackedStatus
      ? ' Tracked changes (paths/status only): ' + JSON.stringify(facts.trackedStatus.split(/\r?\n/).slice(0, 25))
      : '';
    throw new Error('Frozen candidate verification failed: ' + mismatches.join(', ') + '.' + changes);
  }
}
export function compareCargoManifests(original, built) {
  // Python 3.12/tomllib is already installed on the standard Windows image.
  // Isolated standard-library imports and stdin keep source out of commands/logs.
  let input;
  try {
    const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
    const decode = value => {
      if (typeof value !== 'string') return decoder.decode(value);
      if (Buffer.from(value, 'utf8').toString('utf8') !== value) throw new Error();
      return value;
    };
    input = JSON.stringify({ original: decode(original), built: decode(built) });
  } catch {
    return { equivalent: false, parser: 'python.tomllib', python: 'not-run-invalid-utf8' };
  }
  const script = `import datetime, json, math, platform, sys, tomllib
def same(a, b):
    if type(a) is not type(b): return False
    if isinstance(a, dict): return a.keys() == b.keys() and all(same(a[k], b[k]) for k in a)
    if isinstance(a, list): return len(a) == len(b) and all(same(x, y) for x, y in zip(a, b))
    if isinstance(a, float):
        if math.isnan(a) or math.isnan(b): return math.isnan(a) and math.isnan(b) and math.copysign(1, a) == math.copysign(1, b)
        return a == b and (a != 0 or math.copysign(1, a) == math.copysign(1, b))
    if isinstance(a, (datetime.datetime, datetime.date, datetime.time)): return a.isoformat() == b.isoformat()
    return a == b
try:
    values = json.load(sys.stdin)
    equivalent = same(tomllib.loads(values['original']), tomllib.loads(values['built']))
except Exception:
    equivalent = False
print(json.dumps({'equivalent': equivalent, 'parser': 'python.tomllib', 'python': platform.python_version()}))
`;
  try {
    const result = JSON.parse(execFileSync('python', ['-I', '-S', '-c', script], {
      input, encoding: 'utf8', timeout: 15000, stdio: ['pipe', 'pipe', 'pipe'],
    }));
    if (typeof result.equivalent !== 'boolean' || result.parser !== 'python.tomllib' || typeof result.python !== 'string') throw new Error();
    return result;
  } catch {
    throw new Error('Isolated standard-library TOML comparison is unavailable; tracked manifest changes remain forbidden.');
  }
}
export function assertAdmission(receipt, run, original) {
  if (!receipt || receipt.source !== SOURCE || receipt.tree !== TREE || receipt.version !== VERSION || receipt.verdict !== 'passed' || receipt.run !== run
    || receipt.cargoManifest?.path !== CARGO_MANIFEST || receipt.cargoManifest?.frozenSha256 !== hash(original)
    || !/^[a-f0-9]{64}$/.test(receipt.cargoManifest?.admittedSha256 ?? '') || receipt.cargoManifest?.trackedState !== 'clean') throw new Error('This run has no source-bound clean essential gate and manifest baseline receipt.');
}
export function manifestModesUnchanged(rawDiff, { frozenEntry, indexEntry, regularFile, executable, normalizedBlob } = {}) {
  // A CRLF checkout rewritten to LF can remain porcelain-dirty while Git's
  // normalized raw diff is empty. Prove modes independently before that case.
  const frozen = (frozenEntry ?? '').split('\t');
  const index = (indexEntry ?? '').split('\t');
  const frozenMetadata = /^100644 blob ([a-f0-9]{40})$/.exec(frozen[0]);
  const indexMetadata = /^100644 ([a-f0-9]{40}) 0$/.exec(index[0]);
  if (frozen.length !== 2 || index.length !== 2 || frozen[1] !== CARGO_MANIFEST || index[1] !== CARGO_MANIFEST
    || !frozenMetadata || !indexMetadata || frozenMetadata[1] !== indexMetadata[1] || regularFile !== true || executable !== false) return false;
  if (rawDiff === '') return normalizedBlob === frozenMetadata[1];
  const lines = rawDiff.split(/\r?\n/);
  if (lines.length !== 1) return false;
  const fields = lines[0].split('\t');
  return fields.length === 2 && fields[1] === CARGO_MANIFEST && fields[0] === ':100644 100644 ' + frozenMetadata[1] + ' ' + '0'.repeat(40) + ' M';
}
export function assertBuildCandidate(facts, { original, built, admission, run }) {
  // All frozen identity/trust checks remain mandatory. Only this exact unstaged
  // path may differ, after clean admission, and only with full typed TOML equality.
  assertCandidate({ ...facts, dirty: false });
  if (Boolean(facts.dirty) !== Boolean(facts.trackedStatus)) throw new Error('Tracked candidate state is inconsistent.');
  if (facts.dirty && facts.trackedStatus !== ' M ' + CARGO_MANIFEST) assertCandidate(facts);
  if (facts.dirty && facts.manifestModesUnchanged !== true) throw new Error('Cargo.toml file mode or type changed, or its unchanged regular-file mode could not be verified.');
  assertAdmission(admission, run, original);
  const comparison = compareCargoManifests(original, built);
  if (!comparison.equivalent) throw new Error('Frozen Cargo.toml has malformed TOML or semantic changes; publication refused.');
  return { path: CARGO_MANIFEST, frozenSha256: hash(original), admittedSha256: admission.cargoManifest.admittedSha256,
    builtSha256: hash(built), semanticEquality: true, parser: comparison.parser, python: comparison.python,
    trackedState: facts.dirty ? 'unstaged-representation-only' : 'clean' };
}
function candidate({ allowCargoSerialization = false } = {}) {
  const config = json(join(root, 'apps/desktop/src-tauri/tauri.conf.json'));
  const cargo = readFileSync(join(root, 'apps/desktop/src-tauri/Cargo.toml'), 'utf8');
  const section = cargo.split('[package]')[1]?.split(/^\[/m)[0] ?? '';
  const trackedStatus = git(['status', '--porcelain=v1', '--untracked-files=no']);
  let modesUnchanged = false;
  if (allowCargoSerialization && trackedStatus === ' M ' + CARGO_MANIFEST) {
    const stat = lstatSync(join(root, CARGO_MANIFEST));
    modesUnchanged = manifestModesUnchanged(git(['diff', '--raw', '--no-abbrev', '--no-ext-diff', '--no-renames', '--', CARGO_MANIFEST]), {
      frozenEntry: git(['ls-tree', SOURCE, '--', CARGO_MANIFEST]), indexEntry: git(['ls-files', '--stage', '--', CARGO_MANIFEST]),
      regularFile: stat.isFile(), executable: process.platform !== 'win32' && Boolean(stat.mode & 0o111),
      normalizedBlob: git(['hash-object', '--path=' + CARGO_MANIFEST, CARGO_MANIFEST]),
    });
  }
  const facts = { source: git(['rev-parse', 'HEAD']), tree: git(['rev-parse', 'HEAD^{tree}']), dirty: Boolean(trackedStatus), trackedStatus, manifestModesUnchanged: modesUnchanged, version: config.version, cargoVersion: section.match(/^version\s*=\s*"([^"]+)"/m)?.[1], key: config.plugins?.updater?.pubkey };
  if (!allowCargoSerialization) { assertCandidate(facts); return; }
  return assertBuildCandidate(facts, { original: gitBytes(['show', SOURCE + ':' + CARGO_MANIFEST]), built: readFileSync(join(root, CARGO_MANIFEST)), admission: json(join(stage, 'cloud-admission.json')), run: runUrl() });
}
async function checkpoint() {
  if (process.argv[3] && process.argv[3] !== 'after-native') throw new Error('Unknown candidate checkpoint phase.');
  const manifest = candidate({ allowCargoSerialization: process.argv[3] === 'after-native' });
  console.log(manifest ? 'Frozen candidate verified; full typed Cargo.toml semantics unchanged: ' + JSON.stringify(manifest) : 'Frozen source/tree/version/key and clean tracked state confirmed.');
}
export function assertExisting(release) {
  if (!release) return;
  if (release.tag_name !== `v${VERSION}` || release.prerelease !== true || !release.body?.includes(MARKER)) throw new Error('Existing version has a different source/qualification; immutable publication refused.');
}
export function assetMatches(asset, expected) {
  return asset.name === expected.name && asset.size === expected.size && asset.digest === 'sha256:' + expected.sha256 && asset.state === 'uploaded';
}
export function requestUrl(path) {
  return path.startsWith('https://uploads.github.com/') ? path : `https://api.github.com/repos/${REPO}${path ? '/' + path : ''}`;
}
export function assertPublicRepository(repo) {
  if (!repo || repo.private !== false || repo.full_name !== REPO) throw new Error('Public repository/free standard runner cost boundary is not satisfied.');
}
async function request(path, { method = 'GET', body, bytes, contentType } = {}) {
  if (!process.env.GH_TOKEN) throw new Error('Existing GitHub execution token is unavailable.');
  const url = requestUrl(path);
  const response = await fetch(url, { method, headers: { authorization: `Bearer ${process.env.GH_TOKEN}`, accept: 'application/vnd.github+json', 'content-type': contentType ?? 'application/json' }, body: bytes ?? (body ? JSON.stringify(body) : undefined), redirect: 'error', signal: AbortSignal.timeout(bytes ? 300000 : 20000) });
  if (response.status === 404 && method === 'GET') return null;
  if (!response.ok) throw new Error(`GitHub ${method} failed: HTTP ${response.status}`);
  return response.status === 204 ? null : response.json();
}
const currentRelease = () => request(`releases/tags/v${VERSION}`);

async function preflight() {
  if (process.env.GITHUB_REPOSITORY !== REPO || process.env.GITHUB_ACTOR !== 'nic21vdw' || process.env.RUNNER_OS !== 'Windows' || process.env.GITHUB_EVENT_NAME !== 'workflow_dispatch') throw new Error('Only the owner manual dispatch on a public standard Windows runner is supported.');
  const repo = await request('');
  assertPublicRepository(repo);
  for (const name of ['SOURCE_DEPLOY_KEY', 'TAURI_SIGNING_PRIVATE_KEY']) if (!process.env[name]?.trim()) throw new Error('Existing environment credential is unavailable: ' + name + '. Stop; do not create keys or grants.');
  const existing = await currentRelease();
  assertExisting(existing);
  if (existing && (!existing.draft || existing.assets?.length)) throw new Error('This candidate already has retained assets. Reconcile and reuse that release before another build: ' + existing.html_url);
  console.log('Public standard Windows runner; existing credentials present; no conflicting retained candidate. No release write has occurred.');
}
async function admission() {
  candidate();
  const { USER_TESTING_ESSENTIAL_TESTS } = await import(pathToFileURL(join(root, 'scripts/lib/userTestingVerification.mjs')).href);
  const tests = [...USER_TESTING_ESSENTIAL_TESTS].sort();
  if (!tests.length || tests.some(name => /Browser\.test\.mjs$/.test(name))) throw new Error('Essential gate selection is invalid.');
  const runner = join(root, 'scripts/run-tests.mjs');
  const env = { ...process.env, COLATERAL_USER_TESTING_SCOPE: '' };
  const listed = execFileSync(process.execPath, [runner, '--list', ...tests], { cwd: root, encoding: 'utf8', timeout: 30000, env });
  const actual = listed.split(/\r?\n/).map(line => line.trim()).filter(line => /^[a-zA-Z0-9_-]+\.test\.mjs$/.test(line)).sort();
  if (JSON.stringify(actual) !== JSON.stringify(tests)) throw new Error('Actual runner selection differs from the frozen essential gates.');
  execFileSync(process.execPath, [runner, ...tests], { cwd: root, stdio: 'inherit', timeout: 890000, env });
  candidate();
  mkdirSync(stage, { recursive: true });
  const cargoManifest = { path: CARGO_MANIFEST, frozenSha256: hash(gitBytes(['show', SOURCE + ':' + CARGO_MANIFEST])), admittedSha256: hash(readFileSync(join(root, CARGO_MANIFEST))), trackedState: 'clean' };
  write('cloud-admission.json', { schema: 1, source: SOURCE, tree: TREE, version: VERSION, tests, verdict: 'passed', cargoManifest, qualification: 'build-only', gameplayAcceptance: 'deferred-to-user', run: runUrl(), at: new Date().toISOString() });
}
async function stageBuild() {
  const cargoManifest = candidate({ allowCargoSerialization: true });
  const bundle = join(root, 'apps/desktop/src-tauri/target/release/bundle/nsis');
  for (const name of [INSTALLER, SIGNATURE]) copyFileSync(join(bundle, name), join(stage, name));
  const signature = readFileSync(join(stage, SIGNATURE), 'utf8').trim();
  write('latest.json', { version: VERSION, notes: 'Windows manual preview cloud rebuild. Gameplay/native qualification unverified. Stable and paid delivery unchanged.', pub_date: new Date().toISOString(), manual_preview: { source: SOURCE, tree: TREE, qualification: 'build-only', platform: 'windows-x86_64' }, platforms: { 'windows-x86_64': { signature, url: `https://github.com/${REPO}/releases/download/v${VERSION}/${INSTALLER}` } } });
  execFileSync(process.execPath, [join(root, 'scripts/check-updater-manifest.mjs'), '--manifest', join(stage, 'latest.json'), '--dir', stage, '--platforms', 'windows-x86_64', '--source', SOURCE], { cwd: root, stdio: 'inherit', timeout: 180000 });
  const files = Object.fromEntries([INSTALLER, SIGNATURE, 'latest.json', 'cloud-admission.json'].map(name => [name, hash(readFileSync(join(stage, name)))]));
  write('cloud-build-receipt.json', { schema: 1, source: SOURCE, tree: TREE, version: VERSION, kind: 'cloud-rebuild', files, cargoManifest, updaterKeyId: '3a080422589e4207', updaterSignature: 'verified', authenticode: 'unverified-optional', desktopParity: 'passed', qualification: 'build-only', gameplayAcceptance: 'deferred-to-user', run: runUrl(), toolingSource: process.env.GITHUB_SHA, builtAt: new Date().toISOString() });
}
async function publish() {
  const cargoManifest = candidate({ allowCargoSerialization: true });
  const receipt = json(join(stage, 'cloud-build-receipt.json'));
  if (receipt.source !== SOURCE || receipt.tree !== TREE || receipt.version !== VERSION || receipt.run !== runUrl() || receipt.updaterSignature !== 'verified') throw new Error('Actual source-bound cloud build receipt is missing.');
  if (JSON.stringify(receipt.cargoManifest) !== JSON.stringify(cargoManifest)) throw new Error('Verified manifest representation or semantic-equality receipt changed after staging.');
  for (const [name, digest] of Object.entries(receipt.files)) if (hash(readFileSync(join(stage, name))) !== digest) throw new Error('Verified artifact changed: ' + name);
  const names = [INSTALLER, SIGNATURE, 'latest.json', 'cloud-admission.json', 'cloud-build-receipt.json'];
  const files = names.map(name => { const bytes = readFileSync(join(stage, name)); return { name, bytes, size: bytes.length, sha256: hash(bytes) }; });
  let release = await currentRelease();
  assertExisting(release);
  if (!release) {
    try { release = await request('releases', { method: 'POST', body: { tag_name: `v${VERSION}`, target_commitish: process.env.GITHUB_SHA, name: `CoLateral ${VERSION} Windows manual preview (cloud rebuild)`, body: `${MARKER}\n\nUpdater signature verified with unchanged key 3a080422589e4207. Authenticode, native upgrade acceptance and gameplay remain unverified. Stable and paid delivery stay unchanged.\n\nInstaller SHA-256: ${files[0].sha256}\nBuild run: ${runUrl()}`, draft: true, prerelease: true, make_latest: 'false' } }); }
    catch (error) { release = await currentRelease(); if (!release) throw error; }
    assertExisting(release);
  }
  for (const file of files) {
    release = await request(`releases/${release.id}`);
    assertExisting(release);
    const prior = release.assets?.find(asset => asset.name === file.name);
    if (prior) { if (!assetMatches(prior, file)) throw new Error('Immutable retained asset conflicts: ' + file.name); continue; }
    if (!release.draft) throw new Error('Published release is missing verified assets; publication cannot be amended.');
    try { await request(`https://uploads.github.com/repos/${REPO}/releases/${release.id}/assets?name=${encodeURIComponent(file.name)}`, { method: 'POST', bytes: file.bytes, contentType: 'application/octet-stream' }); }
    catch (error) { const reconciled = await request(`releases/${release.id}`); if (!reconciled?.assets?.some(asset => assetMatches(asset, file))) throw error; }
  }
  release = await request(`releases/${release.id}`);
  if (release.assets.length !== files.length || !files.every(file => release.assets.some(asset => assetMatches(asset, file)))) throw new Error('Retained assets are incomplete or include unexpected files.');
  if (release.draft) {
    try { await request(`releases/${release.id}`, { method: 'PATCH', body: { draft: false, prerelease: true, make_latest: 'false' } }); }
    catch (error) { const found = await currentRelease(); if (!found || found.draft || !found.prerelease) throw error; }
  }
  release = await currentRelease();
  assertExisting(release);
  if (release.draft || !release.prerelease) throw new Error('Manual prerelease publication is not confirmed.');
  for (const file of files) {
    const url = `https://github.com/${REPO}/releases/download/v${VERSION}/${file.name}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(300000) });
    if (!response.ok || hash(Buffer.from(await response.arrayBuffer())) !== file.sha256) throw new Error('Anonymous public bytes do not match verified artifact: ' + file.name);
  }
  console.log(JSON.stringify({ release: release.html_url, installer: `https://github.com/${REPO}/releases/download/v${VERSION}/${INSTALLER}`, source: SOURCE, tree: TREE, sha256: files[0].sha256, qualification: 'manual-preview', stablePromotion: false, publiclyVerified: true }));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const actions = { preflight, admission, checkpoint, stage: stageBuild, publish };
  const action = actions[process.argv[2]];
  if (!action) throw new Error('Choose preflight, admission, checkpoint, stage or publish.');
  await action();
}


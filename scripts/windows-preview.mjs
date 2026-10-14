import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, copyFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const SOURCE = '71c50bb5feb7b5dbc5b621c2e8153693d6fc8807';
export const TREE = '8b6da97c597ce49ac63dfb0de4dc6d8353b1c826';
export const VERSION = '1.0.73';
export const REPO = 'nic21vdw/colateral-releases';
export const KEY = 'dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDc0MjlFNTgyMjA0MDgzQQpSV1E2Q0FRaVdKNUNCMDc4c2k5Z3RMSFd3VmFjQndOR2JGVTBRd3ExajhSeDBRN1VFNkYram1hZwo=';
export const INSTALLER = `CoLateral_${VERSION}_x64-setup.exe`;
export const SIGNATURE = INSTALLER + '.sig';
export const MARKER = `Frozen source: ${SOURCE}\nFrozen tree: ${TREE}\nCloud rebuild; original NicPC installer was not used.`;
const root = resolve('candidate'), stage = resolve('preview-assets');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = file => JSON.parse(readFileSync(file, 'utf8'));
const git = args => execFileSync('git', ['-c', 'core.fsmonitor=false', ...args], { cwd: root, encoding: 'utf8', timeout: 15000 }).trim();
const write = (name, value) => writeFileSync(join(stage, name), JSON.stringify(value, null, 2) + '\n');
const runUrl = () => `https://github.com/${REPO}/actions/runs/${process.env.GITHUB_RUN_ID}`;

export function assertCandidate(facts) {
  if (facts.source !== SOURCE || facts.tree !== TREE || facts.dirty || facts.version !== VERSION || facts.cargoVersion !== VERSION || facts.key !== KEY) throw new Error('Frozen source/tree/version/key or clean tracked state differs.');
}
function candidate() {
  const config = json(join(root, 'apps/desktop/src-tauri/tauri.conf.json'));
  const cargo = readFileSync(join(root, 'apps/desktop/src-tauri/Cargo.toml'), 'utf8');
  const section = cargo.split('[package]')[1]?.split(/^\[/m)[0] ?? '';
  assertCandidate({ source: git(['rev-parse', 'HEAD']), tree: git(['rev-parse', 'HEAD^{tree}']), dirty: Boolean(git(['status', '--porcelain=v1', '--untracked-files=no'])), version: config.version, cargoVersion: section.match(/^version\s*=\s*"([^"]+)"/m)?.[1], key: config.plugins?.updater?.pubkey });
}
export function assertExisting(release) {
  if (!release) return;
  if (release.tag_name !== `v${VERSION}` || release.prerelease !== true || !release.body?.includes(MARKER)) throw new Error('Existing version has a different source/qualification; immutable publication refused.');
}
export function assetMatches(asset, expected) {
  return asset.name === expected.name && asset.size === expected.size && asset.digest === 'sha256:' + expected.sha256 && asset.state === 'uploaded';
}
async function request(path, { method = 'GET', body, bytes, contentType } = {}) {
  if (!process.env.GH_TOKEN) throw new Error('Existing GitHub execution token is unavailable.');
  const url = path.startsWith('https://uploads.github.com/') ? path : `https://api.github.com/repos/${REPO}/${path}`;
  const response = await fetch(url, { method, headers: { authorization: `Bearer ${process.env.GH_TOKEN}`, accept: 'application/vnd.github+json', 'content-type': contentType ?? 'application/json' }, body: bytes ?? (body ? JSON.stringify(body) : undefined), redirect: 'error', signal: AbortSignal.timeout(bytes ? 300000 : 20000) });
  if (response.status === 404 && method === 'GET') return null;
  if (!response.ok) throw new Error(`GitHub ${method} failed: HTTP ${response.status}`);
  return response.status === 204 ? null : response.json();
}
const currentRelease = () => request(`releases/tags/v${VERSION}`);

async function preflight() {
  if (process.env.GITHUB_REPOSITORY !== REPO || process.env.GITHUB_ACTOR !== 'nic21vdw' || process.env.RUNNER_OS !== 'Windows' || process.env.GITHUB_EVENT_NAME !== 'workflow_dispatch') throw new Error('Only the owner manual dispatch on a public standard Windows runner is supported.');
  const repo = await request('');
  if (repo.private || repo.full_name !== REPO) throw new Error('Public repository/free standard runner cost boundary is not satisfied.');
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
  write('cloud-admission.json', { schema: 1, source: SOURCE, tree: TREE, version: VERSION, tests, verdict: 'passed', qualification: 'build-only', gameplayAcceptance: 'deferred-to-user', run: runUrl(), at: new Date().toISOString() });
}
async function stageBuild() {
  candidate();
  const admission = json(join(stage, 'cloud-admission.json'));
  if (admission.source !== SOURCE || admission.tree !== TREE || admission.verdict !== 'passed' || admission.run !== runUrl()) throw new Error('This run has no source-bound essential gate receipt.');
  const bundle = join(root, 'apps/desktop/src-tauri/target/release/bundle/nsis');
  for (const name of [INSTALLER, SIGNATURE]) copyFileSync(join(bundle, name), join(stage, name));
  const signature = readFileSync(join(stage, SIGNATURE), 'utf8').trim();
  write('latest.json', { version: VERSION, notes: 'Windows manual preview cloud rebuild. Gameplay/native qualification unverified. Stable and paid delivery unchanged.', pub_date: new Date().toISOString(), manual_preview: { source: SOURCE, tree: TREE, qualification: 'build-only', platform: 'windows-x86_64' }, platforms: { 'windows-x86_64': { signature, url: `https://github.com/${REPO}/releases/download/v${VERSION}/${INSTALLER}` } } });
  execFileSync(process.execPath, [join(root, 'scripts/check-updater-manifest.mjs'), '--manifest', join(stage, 'latest.json'), '--dir', stage, '--platforms', 'windows-x86_64', '--source', SOURCE], { cwd: root, stdio: 'inherit', timeout: 180000 });
  const files = Object.fromEntries([INSTALLER, SIGNATURE, 'latest.json', 'cloud-admission.json'].map(name => [name, hash(readFileSync(join(stage, name)))]));
  write('cloud-build-receipt.json', { schema: 1, source: SOURCE, tree: TREE, version: VERSION, kind: 'cloud-rebuild', files, updaterKeyId: '3a080422589e4207', updaterSignature: 'verified', authenticode: 'unverified-optional', desktopParity: 'passed', qualification: 'build-only', gameplayAcceptance: 'deferred-to-user', run: runUrl(), toolingSource: process.env.GITHUB_SHA, builtAt: new Date().toISOString() });
}
async function publish() {
  candidate();
  const receipt = json(join(stage, 'cloud-build-receipt.json'));
  if (receipt.source !== SOURCE || receipt.tree !== TREE || receipt.version !== VERSION || receipt.run !== runUrl() || receipt.updaterSignature !== 'verified') throw new Error('Actual source-bound cloud build receipt is missing.');
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
  const actions = { preflight, admission, stage: stageBuild, publish };
  const action = actions[process.argv[2]];
  if (!action) throw new Error('Choose preflight, admission, stage or publish.');
  await action();
}

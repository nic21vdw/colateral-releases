import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { auditReleases, generateChecksums, parseChecksumFile, SUMS_FILE } from '../scripts/release-checksums.mjs';
import { assetNameFromUrl, checkManifests, decodeSignature } from '../scripts/check-updater-manifests.mjs';
import { buildEntries, highlightsFromCommits, parseManifestNotes, renderIndex, spliceReadme, START, END } from '../scripts/release-notes-index.mjs';
import { githubReader } from '../scripts/lib/github-read.mjs';

const sha = text => createHash('sha256').update(text).digest('hex');
const asset = (name, body, extra = {}) => ({ name, url: `fixture://${name}`, digest: `sha256:${sha(body)}`, state: 'uploaded', body, ...extra });
const readText = async a => a.body;

test('generate writes one .sha256 per asset and a SHA256SUMS that verify the bytes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'checksums-'));
  try {
    writeFileSync(join(dir, 'CoLateral_9.9.9_x64-setup.exe'), 'invented installer');
    writeFileSync(join(dir, 'CoLateral_9.9.9_universal.dmg'), 'invented dmg');
    writeFileSync(join(dir, 'stale.sha256'), 'ignored');
    const sums = generateChecksums(dir);
    assert.deepEqual(Object.keys(sums), ['CoLateral_9.9.9_universal.dmg', 'CoLateral_9.9.9_x64-setup.exe']);
    assert.equal(sums['CoLateral_9.9.9_x64-setup.exe'], sha('invented installer'));
    const own = parseChecksumFile(readFileSync(join(dir, 'CoLateral_9.9.9_x64-setup.exe.sha256'), 'utf8'));
    assert.equal(own.get('CoLateral_9.9.9_x64-setup.exe'), sha('invented installer'));
    assert.equal(parseChecksumFile(readFileSync(join(dir, SUMS_FILE), 'utf8')).size, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('checksum lines from Windows and coreutils both parse, and junk is refused', () => {
  const hex = 'A'.repeat(64);
  assert.equal(parseChecksumFile(`${hex} *app.exe\r\n`).get('app.exe'), 'a'.repeat(64));
  assert.equal(parseChecksumFile(`${'b'.repeat(64)}  app.dmg\n`).get('app.dmg'), 'b'.repeat(64));
  assert.throws(() => parseChecksumFile('not a checksum'), /Malformed/);
});

test('audit fails a published release that lacks a checksum file, and catches a wrong one', async () => {
  const exe = asset('a.exe', 'exe');
  const dmg = asset('b.dmg', 'dmg');
  const good = { tag_name: 'v9.0.1', draft: false, assets: [exe, dmg, asset('a.exe.sha256', `${sha('exe')}  a.exe\n`), asset('b.dmg.sha256', `${sha('dmg')}  b.dmg\n`)] };
  const sumsOnly = { tag_name: 'v9.0.2', draft: false, assets: [exe, asset(SUMS_FILE, `${sha('exe')}  a.exe\n`)] };
  const missing = { tag_name: 'v9.0.3', draft: false, assets: [exe] };
  const wrong = { tag_name: 'v9.0.4', draft: false, assets: [exe, asset('a.exe.sha256', `${sha('other')}  a.exe\n`)] };
  const draft = { tag_name: 'v9.0.5', draft: true, assets: [exe] };
  const result = await auditReleases([good, sumsOnly, missing, wrong, draft], readText);
  assert.equal(result.ok, false);
  assert.deepEqual(result.failing, ['v9.0.3', 'v9.0.4']);
  assert.equal(result.reports.find(r => r.tag === 'v9.0.4').rows[0].state, 'mismatch');
  assert.equal(result.reports.some(r => r.tag === 'v9.0.5'), false, 'drafts are not judged');
  assert.equal((await auditReleases([good, missing], readText, { from: 'v9.0.1' })).ok, false);
  assert.equal((await auditReleases([good, missing], readText, { from: 'v9.0.0' })).failing.length, 1);
  assert.equal((await auditReleases([missing, good], readText, { from: 'v9.0.1' })).failing[0], 'v9.0.3');
});

const minisig = file => Buffer.from(`untrusted comment: signature from tauri secret key\nRUQinvented\ntrusted comment: timestamp:1\tfile:${file}\ninvented\n`).toString('base64');
function manifestRelease(version, overrides = {}) {
  const tag = `v${version}`;
  const url = name => `https://github.com/nic21vdw/colateral-releases/releases/download/${tag}/${name}`;
  const names = { 'windows-x86_64': `CoLateral_${version}_x64-setup.exe`, 'linux-x86_64': `CoLateral_${version}_amd64.AppImage`, 'darwin-aarch64': 'CoLateral.app.tar.gz', 'darwin-x86_64': 'CoLateral.app.tar.gz' };
  const platforms = Object.fromEntries(Object.entries(names).map(([p, n]) => [p, { url: url(n), signature: minisig(n) }]));
  const manifest = { version, notes: 'Invented notes', pub_date: '2026-11-06T00:00:00Z', platforms, ...overrides.manifest };
  const assets = [asset('latest.json', JSON.stringify(manifest))];
  for (const n of new Set(Object.values(names))) assets.push(asset(n, 'bin'), asset(`${n}.sig`, minisig(n)));
  return { tag_name: tag, draft: false, prerelease: false, assets: overrides.assets ? overrides.assets(assets) : assets };
}

test('updater manifest check passes a complete release and names every broken piece', async () => {
  const [ok] = await checkManifests(['9.1.0'], [manifestRelease('9.1.0')], readText);
  assert.equal(ok.ok, true, JSON.stringify(ok.findings));
  const [noManifest, draft, absent] = await checkManifests(['9.1.1', '9.1.2', '9.1.3'], [
    manifestRelease('9.1.1', { assets: list => list.filter(a => a.name !== 'latest.json') }),
    { tag_name: 'v9.1.2', draft: true, assets: [] }], readText);
  assert.match(noManifest.findings[0].message, /no latest.json/);
  assert.equal(draft.state, 'draft');
  assert.equal(absent.state, 'missing');
  const broken = manifestRelease('9.1.4', { manifest: { version: '9.1.3' }, assets: list => list.filter(a => a.name !== 'CoLateral.app.tar.gz.sig') });
  const manifest = JSON.parse(broken.assets[0].body);
  delete manifest.platforms['linux-x86_64'];
  manifest.platforms['windows-x86_64'].url = manifest.platforms['windows-x86_64'].url.replace('v9.1.4', 'v9.1.3');
  broken.assets[0].body = JSON.stringify(manifest);
  const [bad] = await checkManifests(['9.1.4'], [broken], readText);
  const text = bad.findings.filter(f => f.level === 'fail').map(f => f.message).join('\n');
  assert.equal(bad.ok, false);
  assert.match(text, /does not match 9.1.4/);
  assert.match(text, /linux-x86_64 is missing/);
  assert.match(text, /points at tag v9.1.3/);
  assert.match(text, /CoLateral.app.tar.gz.sig is not published/);
});

test('signatures must be minisign and made for the file they point at', () => {
  assert.equal(decodeSignature(minisig('a.exe')).file, 'a.exe');
  assert.equal(decodeSignature(''), null);
  assert.equal(decodeSignature(Buffer.from('garbage').toString('base64')), null);
  assert.match(assetNameFromUrl('https://github.com/someone/else/releases/download/v1.0.0/a.exe', 'v1.0.0').error, /another repository/);
});

test('release notes prefer plain update notes and fall back to filtered change titles', async () => {
  const notes = parseManifestNotes('CoLateral 9.2.2 - Big fixes\n\n- The canvas opens faster.\n\n- CoLateral 9.2.1 - Nightly gauntlet fixes\n- Fixes landed by the nightly bug hunt.');
  assert.deepEqual(notes.get('9.2.2'), { title: 'Big fixes', bullets: ['The canvas opens faster.'] });
  const messages = ['Merge pull request #1 from x', 'Release CoLateral 9.2.1', 'test: add fixture', 'feat(canvas): add a zoom slider to the canvas (#12)', 'Repair main: flaky test', 'feat(canvas): add a zoom slider to the canvas (#13)', 'Short'];
  assert.deepEqual(highlightsFromCommits(messages), { highlights: ['Add a zoom slider to the canvas'], total: 1 });
  const calls = [];
  const entries = await buildEntries({
    versions: ['9.2.0', '9.2.1', '9.2.2'],
    releases: [{ tag_name: 'v9.2.2', draft: false, published_at: '2026-11-06T00:00:00Z' }, { tag_name: 'v9.2.1', draft: true, created_at: '2026-11-05T00:00:00Z' }],
    sourceTags: new Set(['v9.2.0', 'v9.2.1', 'v9.2.2']), notes,
    commitsFor: async (base, head) => { calls.push(`${base}...${head}`); return messages; },
  });
  assert.deepEqual(calls, ['v9.2.0...v9.2.1'], 'only versions without plain notes read change titles');
  assert.equal(entries[2].source, 'release notes');
  assert.equal(entries[1].status, 'draft, not published');
  assert.equal(entries[0].source, 'no notes recorded');
  const block = renderIndex(entries);
  assert.ok(block.indexOf('### 9.2.2') < block.indexOf('### 9.2.1'));
  const once = spliceReadme('# Title\n', block);
  assert.equal(spliceReadme(once, block), once, 'regenerating is stable');
  assert.equal(once.split(START).length, 2);
  assert.ok(once.trimEnd().endsWith(END));
});

test('the reader only ever sends GET requests to GitHub', async () => {
  const seen = [];
  const reader = githubReader({ token: '', fetchImpl: async (url, options) => { seen.push([url, options.method]); return Response.json([]); } });
  await reader.pages('/repos/x/y/releases');
  assert.deepEqual(seen, [['https://api.github.com/repos/x/y/releases?per_page=100&page=1', 'GET']]);
  await assert.rejects(reader.assetText({ url: 'https://example.com/a' }), /outside GitHub/);
});

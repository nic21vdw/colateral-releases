import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { assertCandidate, assertExisting, assetMatches, requestUrl, assertPublicRepository, REPO, SOURCE, TREE, VERSION, KEY, MARKER } from '../scripts/windows-preview.mjs';

const frozen = { source: SOURCE, tree: TREE, dirty: false, version: VERSION, cargoVersion: VERSION, key: KEY };
test('source, tree, version and trust changes fail before building', () => {
  assert.doesNotThrow(() => assertCandidate(frozen));
  for (const changed of [{ source: '0'.repeat(40) }, { tree: '0'.repeat(40) }, { version: '1.0.74' }, { cargoVersion: '1.0.72' }, { key: 'another key' }, { dirty: true }]) assert.throws(() => assertCandidate({ ...frozen, ...changed }));
});
test('candidate failures identify mismatching fields without logging their values', () => {
  const unexpected = 'DO-NOT-LOG-CONFIGURATION-OR-KEY-CONTENTS';
  assert.throws(() => assertCandidate({ ...frozen, source: unexpected, tree: unexpected, version: unexpected, cargoVersion: unexpected, key: unexpected }), error => {
    assert.equal(error.message, 'Frozen candidate verification failed: source, tree, version, cargoVersion, key.');
    assert.ok(!error.message.includes(unexpected));
    return true;
  });
});
test('every tracked modification still fails and reports only escaped paths/status', () => {
  for (const status of [' M apps/desktop/src-tauri/Cargo.toml', ' M apps/desktop/src-tauri/Cargo.lock', ' M apps/desktop/app/icon.svg', ' M private-source.js', 'D  removed-file.js', 'R  old-name.js -> new-name.js']) {
    assert.throws(() => assertCandidate({ ...frozen, dirty: true, trackedStatus: status }), error => {
      assert.equal(error.message, 'Frozen candidate verification failed: tracked state. Tracked changes (paths/status only): ' + JSON.stringify([status]));
      return true;
    });
  }
  assert.throws(() => assertCandidate({ ...frozen, dirty: true }), /tracked state/);
});
test('diagnostic checkpoints bracket build mutations without changing the frozen source or runner', () => {
  const workflow = readFileSync(new URL('../.github/workflows/windows-preview.yml', import.meta.url), 'utf8');
  const phases = [
    'Build frozen frontend and bridge assets',
    'Verify frozen tracked source after frontend build',
    'Check desktop canvas parity',
    'Verify frozen tracked source after parity and before native build',
    'Build updater-signed Windows NSIS preview',
    'Verify frozen tracked source after native build',
    'Verify actual installer signature and record new build hashes',
    'Retain verified assets and publish manual prerelease',
  ];
  let previous = -1;
  for (const phase of phases) {
    const offset = workflow.indexOf('- name: ' + phase);
    assert.ok(offset > previous, 'Missing or misplaced checkpoint: ' + phase);
    previous = offset;
  }
  assert.equal((workflow.match(/run: node tooling\/scripts\/windows-preview\.mjs checkpoint/g) ?? []).length, 3);
  assert.match(workflow, /runs-on: windows-latest/);
  assert.match(workflow, new RegExp('ref: ' + SOURCE));
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /tauri build --bundles nsis.*-- --locked/);
});
test('stable and different-source release collisions cannot be overwritten', () => {
  const preview = { tag_name: 'v' + VERSION, prerelease: true, body: MARKER };
  assert.doesNotThrow(() => assertExisting(null));
  assert.doesNotThrow(() => assertExisting(preview));
  for (const changed of [{ prerelease: false }, { tag_name: 'v1.0.72' }, { body: 'Other source' }]) assert.throws(() => assertExisting({ ...preview, ...changed }));
});
test('partial or conflicting asset metadata is never treated as a successful upload', () => {
  const file = { name: 'preview.exe', size: 23, sha256: 'a'.repeat(64) };
  const asset = { name: file.name, size: file.size, digest: 'sha256:' + file.sha256, state: 'uploaded' };
  assert.equal(assetMatches(asset, file), true);
  for (const changed of [{ size: 22 }, { digest: 'sha256:' + 'b'.repeat(64) }, { state: 'new' }, { name: 'other.exe' }]) assert.equal(assetMatches({ ...asset, ...changed }, file), false);
});

test('repository root URL has no trailing slash and missing repository fails closed', () => {
  assert.equal(requestUrl(''), `https://api.github.com/repos/${REPO}`);
  assert.equal(requestUrl('releases/tags/v1.0.73'), `https://api.github.com/repos/${REPO}/releases/tags/v1.0.73`);
  const upload = `https://uploads.github.com/repos/${REPO}/releases/123/assets?name=preview.exe`;
  assert.equal(requestUrl(upload), upload);
  assert.doesNotThrow(() => assertPublicRepository({ private: false, full_name: REPO }));
  for (const repo of [null, {}, { private: true, full_name: REPO }, { private: false, full_name: 'other/repo' }, { full_name: REPO }]) assert.throws(() => assertPublicRepository(repo), /Public repository/);
});


import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { assertCandidate, assertBuildCandidate, compareCargoManifests, manifestModesUnchanged, assertExisting, assetMatches, requestUrl, assertPublicRepository, CARGO_MANIFEST, REPO, SOURCE, TREE, VERSION, KEY, MARKER } from '../scripts/windows-preview.mjs';

const frozen = { source: SOURCE, tree: TREE, dirty: false, version: VERSION, cargoVersion: VERSION, key: KEY };
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const originalCargo = '[package]\nname = "colateral-desktop"\nversion = "1.0.73"\n[dependencies]\ntauri = { version = "2", features = [] }\n';
const rewrittenCargo = '# CLI representation rewrite\r\n[package]\r\nversion="1.0.73"\r\nname="colateral-desktop"\r\n[dependencies.tauri]\r\nfeatures=[]\r\nversion="2"\r\n';
const run = 'https://github.com/' + REPO + '/actions/runs/123';
const admission = { source: SOURCE, tree: TREE, version: VERSION, verdict: 'passed', run,
  cargoManifest: { path: CARGO_MANIFEST, frozenSha256: digest(originalCargo), admittedSha256: digest(originalCargo), trackedState: 'clean' } };
const buildFacts = { ...frozen, dirty: true, trackedStatus: ' M ' + CARGO_MANIFEST, manifestModesUnchanged: true };
const buildProof = { original: originalCargo, built: rewrittenCargo, admission, run };
test('only a same-run semantic-equivalent unstaged Cargo manifest rewrite is admitted after build', () => {
  assert.throws(() => assertCandidate(buildFacts), /tracked state/);
  const proof = assertBuildCandidate(buildFacts, buildProof);
  assert.equal(proof.frozenSha256, digest(originalCargo));
  assert.equal(proof.admittedSha256, digest(originalCargo));
  assert.equal(proof.builtSha256, digest(rewrittenCargo));
  assert.equal(proof.semanticEquality, true);
  assert.equal(proof.parser, 'python.tomllib');
  assert.equal(proof.trackedState, 'unstaged-representation-only');
  for (const trackedStatus of ['M  ' + CARGO_MANIFEST, 'MM ' + CARGO_MANIFEST, ' D ' + CARGO_MANIFEST, ' M ' + CARGO_MANIFEST + '\n M private-source.js', ' M apps/desktop/src-tauri/Cargo.lock', '?? ' + CARGO_MANIFEST]) {
    assert.throws(() => assertBuildCandidate({ ...buildFacts, trackedStatus }, buildProof), /tracked state/);
  }
  assert.throws(() => assertBuildCandidate({ ...buildFacts, dirty: false }, buildProof), /inconsistent/);
  for (const change of [{ source: 'other' }, { tree: 'other' }, { key: 'other' }, { version: 'other' }, { cargoVersion: 'other' }]) {
    assert.throws(() => assertBuildCandidate({ ...buildFacts, ...change }, buildProof), /verification failed/);
  }
});
test('manifest proof requires the source-bound clean admission baseline from this run', () => {
  for (const changed of [null, { ...admission, source: 'other' }, { ...admission, tree: 'other' }, { ...admission, version: 'other' }, { ...admission, run: run + '4' }, { ...admission, verdict: 'failed' }, { ...admission, cargoManifest: undefined },
    ...[{ path: 'other' }, { frozenSha256: '0'.repeat(64) }, { admittedSha256: '' }, { trackedState: 'dirty' }].map(change => ({ ...admission, cargoManifest: { ...admission.cargoManifest, ...change } }))]) {
    assert.throws(() => assertBuildCandidate(buildFacts, { ...buildProof, admission: changed }), /baseline receipt/);
  }
});
test('representation-only acceptance rejects executable, symlink, type and unverified mode changes', () => {
  const raw = ':100644 100644 ' + 'a'.repeat(40) + ' ' + '0'.repeat(40) + ' M\t' + CARGO_MANIFEST;
  assert.equal(manifestModesUnchanged(raw), true);
  for (const changed of [raw.replace(':100644 100644', ':100644 100755'), raw.replace(':100644 100644', ':100644 120000'), raw.replace(':100644 100644', ':120000 120000'), raw.replace(':100644 100644', ':100644 000000'), raw.replace(CARGO_MANIFEST, 'other-file'), raw + '\tother-file', raw + '\n' + raw, '']) {
    assert.equal(manifestModesUnchanged(changed), false);
  }
  for (const manifestModesUnchanged of [false, undefined, 'true']) {
    assert.throws(() => assertBuildCandidate({ ...buildFacts, manifestModesUnchanged }, buildProof), /file mode or type changed/);
  }
});
test('typed TOML proof rejects key, dependency, array-order and scalar-value changes', () => {
  assert.equal(compareCargoManifests(originalCargo, rewrittenCargo).equivalent, true);
  for (const built of [rewrittenCargo.replace('version="2"', 'version="3"'), rewrittenCargo.replace('features=[]', 'features=["devtools"]'), rewrittenCargo + 'other=true\n', rewrittenCargo.replace('name="colateral-desktop"', 'name="other"')]) {
    assert.throws(() => assertBuildCandidate(buildFacts, { ...buildProof, built }), /semantic changes/);
  }
  for (const [original, built] of [['value=true', 'value=1'], ['value=1', 'value=1.0'], ['value=["a","b"]', 'value=["b","a"]'], ['value="a b"', 'value="ab"'], ['value={enabled=true}', 'value={enabled=1}'], ['value=[1]', 'value=[1.0]']]) {
    assert.equal(compareCargoManifests(original, built).equivalent, false, original + ' differs from ' + built);
  }
});
test('TOML float special values, negative zero and datetime offsets retain their meaning', () => {
  for (const [original, built, equivalent] of [['value=nan', 'value=+nan', true], ['value=nan', 'value=-nan', false], ['value=inf', 'value=+inf', true], ['value=inf', 'value=-inf', false], ['value=nan', 'value=inf', false], ['value=0.0', 'value=-0.0', false], ['value=-0.0', 'value=-0e0', true], ['value=0', 'value=-0.0', false], ['value=1979-05-27T07:32:00Z', 'value=1979-05-27T07:32:00+00:00', true], ['value=1979-05-27T07:32:00Z', 'value=1979-05-27T08:32:00+01:00', false]]) {
    assert.equal(compareCargoManifests(original, built).equivalent, equivalent, original + ' vs ' + built);
  }
});
test('malformed or duplicate-key TOML fails without revealing parser input', () => {
  for (const malformed of ['secret = "DO-NOT-LOG-THIS', 'value=1\nvalue=2', '[package\nvalue=1', 'value=[1,']) {
    assert.equal(compareCargoManifests(originalCargo, malformed).equivalent, false);
    assert.equal(compareCargoManifests(malformed, originalCargo).equivalent, false);
    assert.throws(() => assertBuildCandidate(buildFacts, { ...buildProof, built: malformed }), error => {
      assert.equal(error.message, 'Frozen Cargo.toml has malformed TOML or semantic changes; publication refused.');
      return true;
    });
  }
});
test('invalid UTF-8 is never repaired into an accepted manifest, including inside comments', () => {
  const valid = Buffer.from(originalCargo, 'utf8');
  for (const invalid of [Buffer.concat([Buffer.from([0x23, 0xff, 0x0a]), valid]), Buffer.concat([valid, Buffer.from([0x23, 0xc3, 0x0a])]), Buffer.concat([valid, Buffer.from([0x23, 0xed, 0xa0, 0x80])])]) {
    assert.equal(compareCargoManifests(valid, invalid).equivalent, false);
    assert.equal(compareCargoManifests(invalid, valid).equivalent, false);
    assert.throws(() => assertBuildCandidate(buildFacts, { ...buildProof, built: invalid }), /malformed TOML or semantic changes/);
  }
  const bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), valid]);
  assert.equal(compareCargoManifests(valid, bom).equivalent, false);
  assert.equal(compareCargoManifests(bom, valid).equivalent, false);
  assert.equal(compareCargoManifests(valid, '# Invalid Unicode \ud800\n' + originalCargo).equivalent, false);
});
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
  assert.equal((workflow.match(/checkpoint after-native/g) ?? []).length, 1);
  assert.match(workflow, /Verify frozen tracked source after native build\n\s+run: node tooling\/scripts\/windows-preview\.mjs checkpoint after-native/);
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


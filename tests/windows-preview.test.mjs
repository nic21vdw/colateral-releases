import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertCandidate, assertExisting, assetMatches, requestUrl, assertPublicRepository, REPO, SOURCE, TREE, VERSION, KEY, MARKER } from '../scripts/windows-preview.mjs';

const frozen = { source: SOURCE, tree: TREE, dirty: false, version: VERSION, cargoVersion: VERSION, key: KEY };
test('source, tree, version and trust changes fail before building', () => {
  assert.doesNotThrow(() => assertCandidate(frozen));
  for (const changed of [{ source: '0'.repeat(40) }, { tree: '0'.repeat(40) }, { version: '1.0.74' }, { cargoVersion: '1.0.72' }, { key: 'another key' }, { dirty: true }]) assert.throws(() => assertCandidate({ ...frozen, ...changed }));
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

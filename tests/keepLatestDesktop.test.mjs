import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { latestDecision, newestDesktopRelease } from '../scripts/keep-latest-desktop.mjs';

const manifest = [{ name: 'latest.json' }];
const release = (tag, extra = {}) => ({ id: tag.length, tag_name: tag, draft: false, prerelease: false, assets: manifest, ...extra });

test('a non-desktop release published later never becomes the desktop latest', () => {
  const releases = [
    release('v1.0.78', { draft: true }),
    release('v1.0.79', { id: 79 }),
    release('marketing-v1.0.0', { id: 1, assets: [{ name: 'colateral-marketing.zip' }] }),
    release('v1.0.75'),
  ];
  assert.equal(newestDesktopRelease(releases).tag_name, 'v1.0.79');
  assert.deepEqual(latestDecision(releases, 'marketing-v1.0.0'), { action: 'set', tag: 'v1.0.79', id: 79, from: 'marketing-v1.0.0' });
  assert.equal(latestDecision(releases, 'v1.0.79').action, 'none');
});

test('drafts, prereleases, previews and releases without an updater manifest are skipped', () => {
  const releases = [
    release('v1.0.80', { draft: true }),
    release('v1.0.81', { prerelease: true }),
    release('v1.0.82', { assets: [{ name: 'CoLateral_1.0.82_x64-setup.exe' }] }),
    release('v1.0.9'),
    release('v1.0.10'),
  ];
  assert.equal(newestDesktopRelease(releases).tag_name, 'v1.0.10', 'versions compare numerically, not as text');
  assert.equal(latestDecision([release('v2.0.0', { draft: true })], null).action, 'none');
});

test('the workflow repairs latest on every publish with only release write access and no secrets', () => {
  const text = readFileSync(new URL('../.github/workflows/keep-latest-desktop.yml', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
  assert.match(text, /release:\n\s+types: \[published, released, edited\]/);
  assert.match(text, /workflow_dispatch:/);
  assert.match(text, /contents: write/);
  assert.match(text, /GH_TOKEN: \$\{\{ github\.token \}\}/);
  assert.match(text, /run: node scripts\/keep-latest-desktop\.mjs/);
  assert.doesNotMatch(text, /secrets\.|pull_request|environment:/);
  for (const match of text.matchAll(/uses:\s*([^\s#]+)/g)) assert.match(match[1], /@[a-f0-9]{40}$/);
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const workflow = name => readFileSync(new URL(`../.github/workflows/${name}`, import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const text = workflow('desktop-release.yml');
const partialText = workflow('desktop-publish-windows-linux.yml');

function job(name, source = text) {
  const start = source.indexOf(`\n  ${name}:\n`);
  assert.ok(start > 0, `job ${name} exists`);
  const next = source.slice(start + 1).search(/\n  [a-z-]+:\n/);
  return next < 0 ? source.slice(start) : source.slice(start, start + 1 + next);
}

function assertPublishOrder(publish, coverage = '') {
  const steps = [
    `desktop-pipeline.mjs validate --dir installers${coverage}`,
    `desktop-pipeline.mjs canary --dir installers${coverage}`,
    `--channel stable${coverage}`,
    `desktop-pipeline.mjs live --dir installers${coverage}`,
    '--prerelease=false --latest',
  ];
  for (const step of steps) assert.ok(publish.includes(step), step);
  const positions = steps.map(step => publish.indexOf(step));
  assert.ok(positions.every((position, i) => i === 0 || positions[i - 1] < position),
    'validate before canary, promote stable, verify live, then mark latest');
}

test('the run title is what the duplicate guard compares', () => {
  assert.match(text, /^run-name: Desktop \$\{\{ inputs\.tag \}\} \$\{\{ inputs\.source \}\}$/m);
  assert.match(job('preflight'), /RELEASE_PREFIX: Desktop/);
  assert.ok(job('preflight').indexOf('Reject an already completed release') < job('preflight').indexOf('uses: actions/checkout@'));
});

test('a full release publishes only after all three builds and payload validation', () => {
  for (const name of ['preflight', 'windows', 'linux', 'macos']) {
    assert.doesNotMatch(job(name), /FULFILMENT_RELEASE_UPLOAD_TOKEN|desktop-pipeline\.mjs (canary|live)|publish-release-record|--latest|--prerelease=false/, name);
  }
  const publish = job('publish');
  assert.match(publish, /^    needs: \[windows, linux, macos\]$/m);
  assert.doesNotMatch(publish, /^    if:/m, 'publish uses the default successful-dependencies condition');
  assertPublishOrder(publish);
});

test('every platform builds from the exact source and the mac job reuses the maintained workflow', () => {
  for (const name of ['preflight', 'windows', 'linux', 'publish']) assert.match(job(name), /ref: \$\{\{ inputs\.source \}\}/, name);
  assert.match(job('preflight'), /merge-base --is-ancestor "\$SOURCE" HEAD/);
  assert.match(job('macos'), /uses: \.\/\.github\/workflows\/macos-release\.yml/);
  assert.match(job('macos'), /called: true/);
  const mac = workflow('macos-release.yml');
  assert.match(mac, /workflow_call:/);
  assert.match(mac, /ref: \$\{\{ inputs\.called && inputs\.source \|\| inputs\.tag \}\}/);
  assert.match(mac, /\[ "\$HEAD_SHA" = "\$SOURCE" \]/, 'a called build still proves it checked out the source');
});

test('secrets stay in the steps that use them and actions are pinned', () => {
  assert.doesNotMatch(text, /secrets\.[A-Z_]+[^\n]*\n[^\n]*GITHUB_ENV/);
  for (const line of text.split('\n').filter(line => /GITHUB_ENV/.test(line))) assert.doesNotMatch(line, /AZURE_CLIENT_SECRET|TAURI_SIGNING|FULFILMENT/);
  for (const match of text.matchAll(/uses:\s*([^\s#]+)/g)) if (!match[1].startsWith('./')) assert.match(match[1], /@[a-f0-9]{40}$/);
  for (const step of text.split(/\n\s*- /).filter(step => /uses: actions\/checkout@/.test(step))) assert.match(step, /persist-credentials: false/);
  assert.match(text, /cancel-in-progress: false/);
  assert.match(job('preflight'), /github\.actor == 'nic21vdw'/);
});

test('both publishers require the scoped release token before the publish steps', () => {
  for (const source of [text, partialText]) {
    const publish = job('publish', source);
    assert.match(publish, /^    environment: mac-release$/m);
    assert.match(publish, /^      FULFILMENT_RELEASE_UPLOAD_TOKEN: \$\{\{ secrets\.FULFILMENT_RELEASE_UPLOAD_TOKEN \}\}$/m);
    assert.match(publish, /\[ -n "\$FULFILMENT_RELEASE_UPLOAD_TOKEN" \] \|\| \{[^\n]+; exit 1; \}/);
    assert.ok(publish.indexOf('Publish secret is present') < publish.indexOf('uses: actions/checkout@'));
  }
});

test('the Windows and Linux publisher only dispatches manually and validates its coverage', () => {
  const triggers = partialText.split('\npermissions:', 1)[0].split('\non:\n')[1];
  assert.deepEqual(triggers.match(/^  [a-z_]+:/gm), ['  workflow_dispatch:']);
  assert.match(partialText, /^  group: desktop-release-\$\{\{ inputs\.tag \}\}$/m);
  assert.match(partialText, /^  cancel-in-progress: false$/m);
  const publish = job('publish', partialText);
  assert.match(publish, /ref: \$\{\{ inputs\.source \}\}/);
  assert.match(publish, /\[ "\$\(git rev-parse HEAD\)" = "\$SOURCE" \]/);
  assertPublishOrder(publish, ' --coverage windows-linux');
});

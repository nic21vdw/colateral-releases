import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const workflow = name => readFileSync(new URL(`../.github/workflows/${name}`, import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const text = workflow('desktop-release.yml');
const job = name => {
  const start = text.indexOf(`\n  ${name}:\n`);
  assert.ok(start > 0, `job ${name} exists`);
  const next = text.slice(start + 1).search(/\n  [a-z-]+:\n/);
  return next < 0 ? text.slice(start) : text.slice(start, start + 1 + next);
};

test('the run title is what the duplicate guard compares', () => {
  assert.match(text, /^run-name: Desktop \$\{\{ inputs\.tag \}\} \$\{\{ inputs\.source \}\}$/m);
  assert.match(job('preflight'), /RELEASE_PREFIX: Desktop/);
  assert.ok(job('preflight').indexOf('Reject an already completed release') < job('preflight').indexOf('uses: actions/checkout@'));
});

test('only the gated publish job can touch the release record or the live channel', () => {
  for (const name of ['preflight', 'windows', 'linux', 'approve']) {
    assert.doesNotMatch(job(name), /FULFILMENT_RELEASE_UPLOAD_TOKEN|desktop-pipeline\.mjs (canary|live)|publish-release-record|--latest|--prerelease=false/, name);
  }
  const publish = job('publish');
  assert.match(job('approve'), /environment: desktop-publish/);
  assert.match(job('approve'), /needs: \[windows, linux, macos\]/);
  assert.match(publish, /needs: approve/);
  for (const step of ['desktop-pipeline.mjs validate', 'desktop-pipeline.mjs canary', '--channel stable', 'desktop-pipeline.mjs live', '--latest']) assert.ok(publish.includes(step), step);
  assert.ok(publish.indexOf('desktop-pipeline.mjs validate') < publish.indexOf('desktop-pipeline.mjs canary'));
  assert.ok(publish.indexOf('desktop-pipeline.mjs canary') < publish.indexOf('--channel stable'));
  assert.ok(publish.indexOf('--channel stable') < publish.indexOf('--latest'));
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

test('an unprotected publish environment refuses instead of waving the release through', () => {
  assert.match(job('approve'), /protection_rules/);
  assert.match(job('approve'), /\*,required_reviewers,\*\) ;;/);
});

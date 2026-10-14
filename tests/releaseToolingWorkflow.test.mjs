import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { assertPreviewSigningPolicy, runToolingRegressions, REGRESSION_TESTS } from '../scripts/release-tooling-preflight.mjs';

const workflow = name => readFileSync(new URL(`../.github/workflows/${name}`, import.meta.url), 'utf8').replaceAll('\r\n', '\n');

test('real Git newline and typed TOML fixtures execute automatically before private checkout, secrets and compilation', () => {
  const text = workflow('windows-preview.yml');
  const gate = text.indexOf('run: node tooling/scripts/release-tooling-preflight.mjs');
  assert.ok(gate > 0);
  for (const later of ['name: Check existing credential presence', 'repository: nic21vdw/CoLateral-AI', 'name: Install frozen dependency locks',
    'name: Build frozen frontend', 'name: Build updater-signed Windows']) assert.ok(text.indexOf(later) > gate, later);
  for (const prerequisite of ['uses: actions/setup-node@', 'uses: actions/setup-python@']) assert.ok(text.indexOf(prerequisite) < gate, prerequisite);
  const gateStep = text.slice(text.lastIndexOf('      - name:', gate), text.indexOf('      - name:', gate));
  assert.doesNotMatch(gateStep, /continue-on-error|if:\s*(?:always|failure)|\|\|\s*true|secrets\./);
  assert.match(gateStep, /timeout-minutes: 3/);
  assert.ok(REGRESSION_TESTS.includes('tests/windows-preview.test.mjs'));
  assert.ok(REGRESSION_TESTS.includes('tests/releaseDispatchGuard.test.mjs'));
});

test('public tooling CI covers proposed and merged changes on Windows with no private source, secrets or publish permission', () => {
  const text = workflow('release-tooling.yml');
  for (const trigger of ['pull_request:', 'push:', 'workflow_dispatch:']) assert.ok(text.includes(trigger));
  assert.match(text, /runs-on: windows-latest/);
  assert.match(text, /contents: read/);
  assert.match(text, /timeout-minutes: 5/);
  assert.match(text, /run: node scripts\/release-tooling-preflight\.mjs/);
  assert.doesNotMatch(text, /pull_request_target|secrets\.|environment:|contents: write|actions: write|ssh-key:|continue-on-error/);
});

test('new toolchain actions and runtimes are pinned consistently, without persisting checkout credentials', () => {
  for (const name of ['windows-preview.yml', 'release-tooling.yml']) {
    const text = workflow(name);
    for (const match of text.matchAll(/uses:\s*([^\s#]+)/g)) assert.match(match[1], /@[a-f0-9]{40}$/);
    assert.match(text, /node-version: 24\.19\.0/);
    assert.match(text, /python-version: 3\.12\.10/);
    const checkouts = text.split(/\n\s*- /).filter(step => /uses: actions\/checkout@/.test(step));
    for (const checkout of checkouts) assert.match(checkout, /persist-credentials: false/);
  }
});

test('retained publication skips every later build step and fresh ownership checkpoints bracket expensive stages', () => {
  const text = workflow('windows-preview.yml');
  const owner = text.indexOf('run: node tooling/scripts/windows-preview-ownership.mjs initial');
  assert.ok(owner > 0);
  const laterSteps = text.slice(owner).split(/\n      - /).slice(1);
  assert.ok(laterSteps.length > 10);
  for (const step of laterSteps) assert.match(step, /if: steps\.ownership\.outputs\.build_allowed == 'true'/);
  for (const [guard, build] of [['before-frontend', 'Build frozen frontend and bridge assets'], ['before-native', 'Build updater-signed Windows NSIS preview'], ['before-publication', 'Retain verified assets and publish manual prerelease']]) {
    assert.ok(text.indexOf('windows-preview-ownership.mjs ' + guard) < text.indexOf('- name: ' + build));
  }
  assert.match(text, /PREVIEW_RELEASE_HOLD: \$\{\{ vars\.WINDOWS_PREVIEW_HOLD \}\}/);
  assert.match(text, /cancel-in-progress: false/);
});

test('updater signatures remain required and Authenticode is explicitly optional and unverified for this preview', () => {
  assert.deepEqual(assertPreviewSigningPolicy(), { authenticode: 'optional-unverified', updaterSignature: 'required-after-build' });
  assert.throws(() => assertPreviewSigningPolicy({ updaterSignature: 'optional' }), /mandatory/);
  assert.throws(() => assertPreviewSigningPolicy({ authenticode: 'required' }), /separately approved signed release/);
  for (const name of ['windows-preview.yml', 'release-tooling.yml']) {
    assert.match(workflow(name), /PREVIEW_AUTHENTICODE: optional/);
    assert.match(workflow(name), /PREVIEW_UPDATER_SIGNATURE: required/);
  }
  const preview = readFileSync(new URL('../scripts/windows-preview.mjs', import.meta.url), 'utf8');
  assert.match(preview, /authenticode: 'unverified-optional'/);
  assert.match(preview, /scripts\/check-updater-manifest\.mjs/);
  assert.match(preview, /receipt\.updaterSignature !== 'verified'/);
  assert.match(preview, /Anonymous public bytes do not match verified artifact/);
});

test('regression runner is bounded and fails closed before build without printing private diagnostics', () => {
  let called = false;
  const failure = runToolingRegressions({ env: {}, spawn: (command, args, options) => {
    called = true;
    assert.equal(command, process.execPath);
    assert.ok(args.includes('--test-concurrency=1'));
    assert.ok(args.includes('--test-timeout=90000'));
    assert.ok(args.includes('tests/windows-preview.test.mjs'));
    assert.equal(options.timeout, 150000);
    assert.equal(options.maxBuffer, 1024 * 1024);
    return { status: 1, stdout: 'not ok 1 - invented newline regression\nPRIVATE-DIAGNOSTIC-CONTENT\n', stderr: 'PRIVATE-PARSER-INPUT' };
  } });
  assert.equal(called, true);
  assert.equal(failure.ok, false);
  assert.deepEqual(failure.failedTests, ['invented newline regression']);
  assert.match(failure.nextAction, /before any build/);
  assert.doesNotMatch(JSON.stringify(failure), /PRIVATE-/);
  const timeout = runToolingRegressions({ env: {}, spawn: () => ({ status: null, error: { code: 'ETIMEDOUT' } }) });
  assert.equal(timeout.ok, false);
  assert.equal(timeout.reason, 'deadline exceeded');
  const unavailable = runToolingRegressions({ env: {}, spawn: () => ({ status: null, error: { code: 'ENOENT' } }) });
  assert.equal(unavailable.ok, false);
  assert.match(unavailable.nextAction, /Git and Python 3.12/);
});

test('successful tooling evidence makes no build, publication or native installation claim', () => {
  const stdout = '# tests 28\n# pass 28\n# fail 0\n# cancelled 0\n# skipped 0\n';
  const result = runToolingRegressions({ env: {}, spawn: () => ({ status: 0, stdout }) });
  assert.equal(result.ok, true);
  assert.equal(result.updaterSignature, 'required-after-build');
  assert.equal(result.authenticode, 'optional-unverified');
  assert.equal(result.publication, 'not-performed');
  assert.equal(result.nativeQualification, 'not-performed');
  for (const incomplete of ['', stdout.replace('# pass 28', '# pass 27'), stdout.replace('# skipped 0', '# skipped 1')]) {
    assert.equal(runToolingRegressions({ env: {}, spawn: () => ({ status: 0, stdout: incomplete }) }).ok, false);
  }
});

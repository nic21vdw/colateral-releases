import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const REGRESSION_TESTS = [
  'tests/windows-preview.test.mjs',
  'tests/releaseDispatchGuard.test.mjs',
  'tests/releaseToolingWorkflow.test.mjs',
  'tests/windows-preview-ownership.test.mjs',
];

export function assertPreviewSigningPolicy({ authenticode = 'optional', updaterSignature = 'required' } = {}) {
  if (updaterSignature !== 'required') throw new Error('Updater signature verification is mandatory. Restore the required policy; no build was started.');
  if (authenticode !== 'optional') throw new Error('This manual preview has no approved Authenticode signing path. Use the separately approved signed release workflow; no build was started.');
  return { authenticode: 'optional-unverified', updaterSignature: 'required-after-build' };
}

export function runToolingRegressions({ spawn = spawnSync, env = process.env } = {}) {
  const signing = assertPreviewSigningPolicy({ authenticode: env.PREVIEW_AUTHENTICODE, updaterSignature: env.PREVIEW_UPDATER_SIGNATURE });
  // Only public tooling and invented temporary Git/TOML fixtures are used.
  // Run before any private source checkout, credentials or dependency install.
  const result = spawn(process.execPath, ['--max-old-space-size=256', '--test', '--test-reporter=tap', '--test-concurrency=1', '--test-timeout=90000', ...REGRESSION_TESTS], {
    cwd: root, env, encoding: 'utf8', timeout: 150000, maxBuffer: 1024 * 1024, windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const count = name => Number(String(result.stdout || '').match(new RegExp('^# ' + name + ' (\\d+)$', 'm'))?.[1] ?? NaN);
  const completed = count('tests');
  const complete = completed >= REGRESSION_TESTS.length && count('pass') === completed
    && count('fail') === 0 && count('cancelled') === 0 && count('skipped') === 0;
  if (result.error || result.signal || result.status !== 0 || !complete) {
    const reason = result.error?.code === 'ETIMEDOUT' ? 'deadline exceeded' : result.signal ? 'test process interrupted' : 'test failure or missing prerequisite';
    const failedTests = [...new Set([...String(result.stdout || '').matchAll(/^not ok \d+ - (.+)$/gm)].map(match => match[1]))].slice(0, 15);
    // Do not replay raw child output: a future test could print source, paths,
    // environment values or parser input. Keep the public failure actionable.
    return { ok: false, phase: 'release-tooling-regressions', reason, failedTests,
      nextAction: 'Run node scripts/release-tooling-preflight.mjs in the tooling checkout with Git and Python 3.12 available. Repair the named regression or prerequisite, review it, and retry this gate before any build.' };
  }
  return { ok: true, phase: 'release-tooling-regressions', completed, tests: REGRESSION_TESTS, ...signing,
    publication: 'not-performed', nativeQualification: 'not-performed' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = runToolingRegressions();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) {
    console.error('::error::Release tooling regression gate failed before build. See the sanitized result and next action. No release or credential change was performed.');
    process.exitCode = 1;
  }
}

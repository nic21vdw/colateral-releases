import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workflows = join(root, '.github/workflows');
const guards = [];
for (const file of readdirSync(workflows)) {
  const text = readFileSync(join(workflows, file), 'utf8').replaceAll('\r\n', '\n');
  if (!text.includes('Reject an already completed release')) continue;
  const start = text.indexOf("          node --input-type=module <<'NODE'\n");
  const body = text.slice(start).split('\n').slice(1);
  const end = body.indexOf('          NODE');
  assert.ok(start >= 0 && end > 0, `${file}: executable guard is present`);
  guards.push(body.slice(0, end).map(line => line.slice(10)).join('\n'));
  assert.match(text, /actions: read/, 'history queries need explicit read permission');
  assert.match(text, /cancel-in-progress: false/, 'never cancel a publishing run');
  assert.ok(text.indexOf('Reject an already completed release') < text.indexOf('uses: actions/checkout@'), 'reject before any source checkout/build');
  assert.doesNotMatch(guards.at(-1), /\$\{\{/, 'inputs are environment values, not executable interpolation');
}
assert.ok(guards.length > 0);
assert.ok(guards.every(body => body === guards[0]), 'all release workflows share the same guard behavior');
const execute = new (Object.getPrototypeOf(async function () {}).constructor)('process', 'fetch', 'console', guards[0]);
const sha = 'a'.repeat(40);
const identity = `Desktop v1.2.3 ${sha}`;
const completed = (id = 12, title = identity) => ({ id, display_title: title, event: 'workflow_dispatch', conclusion: 'success', status: 'completed', run_attempt: 1 });
const defaults = { GH_TOKEN: 'fixture-only', GITHUB_REPOSITORY: 'fixture/repository', GITHUB_RUN_ID: '99', GITHUB_RUN_ATTEMPT: '1', RELEASE_PREFIX: 'Desktop', RELEASE_TAG: 'v1.2.3', RELEASE_SOURCE: sha };
async function run({ env = {}, pages = [{ total_count: 0, workflow_runs: [] }], current = {}, attempts = [], http = 200, networkError = false } = {}) {
  const process = { env: { ...defaults, ...env }, exitCode: 0 };
  const calls = [], messages = [];
  await execute(process, async (url, options) => {
    calls.push(url);
    assert.ok(url.startsWith('https://api.github.com/repos/fixture/repository/actions/'));
    assert.equal(options.method, undefined, 'GET only; no cancellation or writes');
    assert.equal(options.redirect, 'error');
    if (networkError) throw new Error('fixture network unavailable');
    let data;
    if (url.includes('/attempts/')) data = attempts[Number(url.split('/').at(-1)) - 1];
    else if (url.includes('/workflows/')) data = pages[Number(new URL(url).searchParams.get('page')) - 1];
    else data = { workflow_id: 7, event: 'workflow_dispatch', display_title: identity, ...current };
    return { ok: http === 200, status: http, json: async () => data };
  }, { log: text => messages.push(text), error: text => messages.push(text) });
  return { ...process, calls, messages };
}
assert.equal((await run()).exitCode, 0, 'a fresh identity proceeds');
assert.equal((await run({ pages: [{total_count:1,workflow_runs:[completed()]}] })).exitCode, 1, 'repeat success stops');
const pageOne = Array.from({length:100}, (_,i)=>completed(i+1,`Desktop v9.0.${i} ${sha}`));
const paged = await run({ pages: [{total_count:101,workflow_runs:pageOne},{total_count:101,workflow_runs:[completed(101)]}] });
assert.equal(paged.exitCode, 1, 'success on a later page still stops');
assert.equal(paged.calls.length, 3);
assert.equal((await run({ pages:[{total_count:1,workflow_runs:[completed(12,`Desktop v1.2.3 ${'b'.repeat(40)}`)]}] })).exitCode,0,'different source is not silently treated as completed');
assert.equal((await run({env:{RELEASE_SOURCE:sha.toUpperCase()},pages:[{total_count:1,workflow_runs:[completed(12,identity.toUpperCase())]}]})).exitCode,1,'SHA casing cannot bypass the guard');
assert.equal((await run({current:{display_title:'macOS v1.2.3 '+sha},env:{RELEASE_PREFIX:'macOS'}})).exitCode,0);
assert.equal((await run({pages:[{total_count:1,workflow_runs:[{...completed(12,'Desktop release'),event:'push',head_branch:'v1.2.3',head_sha:sha}]}]})).exitCode,1,'legacy successful tag push is recognized');
for(const conclusion of ['failure','cancelled','timed_out']) assert.equal((await run({env:{GITHUB_RUN_ATTEMPT:'2'},attempts:[{status:'completed',conclusion}]})).exitCode,0,'unsuccessful attempt can be retried');
assert.equal((await run({env:{GITHUB_RUN_ATTEMPT:'3'},attempts:[{status:'completed',conclusion:'success'},{status:'completed',conclusion:'failure'}]})).exitCode,1,'a later failed retry cannot erase earlier success');
assert.equal((await run({env:{GITHUB_RUN_ATTEMPT:'2'},attempts:[{status:'in_progress',conclusion:null}]})).exitCode,1);
assert.equal((await run({pages:[{total_count:1,workflow_runs:[{...completed(),status:'queued',conclusion:null,run_attempt:2}]}],attempts:[{status:'completed',conclusion:'success'}]})).exitCode,1,'a queued rerun cannot hide a previously successful identity');
assert.equal((await run({pages:[{total_count:1,workflow_runs:[{...completed(),conclusion:'failure'}]}]})).exitCode,0,'a failed dispatch can be retried');
for (const http of [401,403,404,429,500]) assert.equal((await run({http})).exitCode,1,'API failure is not evidence of absence');
assert.equal((await run({networkError:true})).exitCode,1);
for (const pages of [[{total_count:1001,workflow_runs:[]}],[{total_count:1,workflow_runs:[]}],[{}],[{total_count:1,workflow_runs:[{}]}]]) assert.equal((await run({pages})).exitCode,1,'incomplete/malformed history stops');
for (const env of [{RELEASE_TAG:'v1.2.3;echo injected'},{RELEASE_SOURCE:'main'},{GITHUB_RUN_ID:'../1'},{GITHUB_RUN_ATTEMPT:'21'},{GH_TOKEN:''}]) {
  const result = await run({env});
  assert.equal(result.exitCode,1);
  assert.equal(result.calls.length,0,'invalid inputs stop before network');
}
assert.equal((await run({current:{display_title:'unrelated'}})).exitCode,1);
// A shrinking listing can skip a successful run across the page boundary.
assert.equal((await run({pages:[{total_count:101,workflow_runs:pageOne},{total_count:100,workflow_runs:[]}]})).exitCode,1,'shrinking run history is not evidence of absence');
assert.equal((await run({pages:[{total_count:101,workflow_runs:pageOne},{total_count:102,workflow_runs:[completed(101,`Desktop v9.1.0 ${sha}`),completed(102,`Desktop v9.1.1 ${sha}`)]}]})).exitCode,1,'growing run history must be reviewed before build');
console.log(`releaseDispatchGuard: PASS (${guards.length} workflow copies; duplicate, pagination, retry, input and API-failure cases)`);

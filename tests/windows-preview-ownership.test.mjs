import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inspectPreviewOwnership } from '../scripts/windows-preview-ownership.mjs';
import { REPO, VERSION } from '../scripts/windows-preview.mjs';

function fixture() {
  const env = { GITHUB_REPOSITORY: REPO, GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1', GITHUB_SHA: 'a'.repeat(40), GH_TOKEN: 'invented-fixture-token' };
  const state = { release: null, repository: { private: false, full_name: REPO }, run: { id: 123, run_attempt: 1, head_sha: env.GITHUB_SHA,
    event: 'workflow_dispatch', status: 'in_progress', path: '.github/workflows/windows-preview.yml' }, calls: [], errorStatus: null };
  const fetchImpl = async (url, options) => {
    state.calls.push(url);
    assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'error'); assert.ok(options.signal);
    assert.ok(url.startsWith(`https://api.github.com/repos/${REPO}`));
    if (state.errorStatus) return new Response('{}', { status: state.errorStatus });
    if (url.endsWith(`/releases/tags/v${VERSION}`)) return state.release ? Response.json(state.release) : new Response('{}', { status: 404 });
    if (url.endsWith('/actions/runs/123')) return Response.json(state.run);
    return Response.json(state.repository);
  };
  return { env, state, fetchImpl };
}

test('retained local publication stops an independently launched cloud attempt without rebuilding or altering assets', async () => {
  const f = fixture();
  f.state.release = { tag_name: `v${VERSION}`, draft: false, prerelease: true, body: 'Invented separate local owner', assets: [{ name: 'retained-installer' }] };
  const before = JSON.stringify(f.state.release);
  const result = await inspectPreviewOwnership(f);
  assert.equal(result.buildAllowed, false); assert.equal(result.owner, 'retained-release');
  assert.match(result.reason, /already published/);
  assert.equal(JSON.stringify(f.state.release), before);
  assert.equal(f.state.calls.length, 2, 'no attempt to claim a different workflow owner');
});

test('empty draft, retained assets and stable publication all belong to their existing owner', async () => {
  for (const release of [{ draft: true, assets: [] }, { draft: true, assets: [{ name: 'retained' }] }, { draft: false, prerelease: false }]) {
    const f = fixture(); f.state.release = { tag_name: `v${VERSION}`, ...release };
    assert.equal((await inspectPreviewOwnership(f)).buildAllowed, false);
  }
});

test('hold prevents even a read and unavailable metadata never establishes owner absence', async () => {
  const held = fixture(); held.env.PREVIEW_RELEASE_HOLD = '1';
  assert.equal((await inspectPreviewOwnership(held)).buildAllowed, false); assert.deepEqual(held.state.calls, []);
  for (const status of [401, 403, 404, 429, 500]) {
    const f = fixture(); f.state.errorStatus = status;
    await assert.rejects(inspectPreviewOwnership(f), /cannot be verified/);
  }
});

test('one exact current workflow attempt is identified; other identities and private repositories remain blocked', async () => {
  const good = fixture(); assert.equal((await inspectPreviewOwnership(good)).owner, 'current-workflow-run');
  for (const change of [f => { f.state.run.id = 124; }, f => { f.state.run.run_attempt = 2; }, f => { f.state.run.head_sha = 'b'.repeat(40); },
    f => { f.state.run.status = 'completed'; }, f => { f.state.run.path = '.github/workflows/other.yml'; }, f => { f.state.repository.private = true; }]) {
    const f = fixture(); change(f); await assert.rejects(inspectPreviewOwnership(f));
  }
});

test('publication appearing after initial admission is found by the next read-only checkpoint', async () => {
  const f = fixture(); assert.equal((await inspectPreviewOwnership(f)).buildAllowed, true);
  f.state.release = { tag_name: `v${VERSION}`, draft: false, prerelease: true };
  assert.equal((await inspectPreviewOwnership(f)).buildAllowed, false);
  assert.ok(f.state.calls.every(url => !url.includes('uploads')));
});

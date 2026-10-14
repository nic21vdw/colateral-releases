import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO, VERSION } from './windows-preview.mjs';

export async function inspectPreviewOwnership({ fetchImpl = fetch, env = process.env } = {}) {
  if (env.PREVIEW_RELEASE_HOLD === '1') return { buildAllowed: false, owner: 'release-hold', reason: 'Release owner hold is active; do not build or publish.' };
  if (env.GITHUB_REPOSITORY !== REPO || !/^[1-9][0-9]*$/.test(env.GITHUB_RUN_ID || '')
    || !/^[1-9][0-9]*$/.test(env.GITHUB_RUN_ATTEMPT || '') || !/^[a-f0-9]{40}$/.test(env.GITHUB_SHA || '')
    || !env.GH_TOKEN) throw new Error('Current owner/run identity or existing read token is unavailable; no build is authorized.');
  async function get(path, allowMissing = false) {
    const response = await fetchImpl(`https://api.github.com/repos/${REPO}${path}`, { method: 'GET', redirect: 'error',
      headers: { authorization: `Bearer ${env.GH_TOKEN}`, accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(20000) });
    if (allowMissing && response.status === 404) return null;
    if (!response.ok) throw new Error('Release ownership cannot be verified; stop before build and inspect repository access or API availability.');
    const bytes = await response.text();
    if (Buffer.byteLength(bytes) > 1024 * 1024) throw new Error('Release ownership evidence is oversized; stop before build.');
    return JSON.parse(bytes);
  }
  const repository = await get('');
  if (repository.private !== false || repository.full_name !== REPO) throw new Error('Existing public repository boundary could not be verified.');
  const retained = await get(`/releases/tags/v${VERSION}`, true);
  if (retained) {
    if (retained.tag_name !== `v${VERSION}` || typeof retained.draft !== 'boolean') throw new Error('Retained release identity is malformed; preserve it for owner review.');
    return { buildAllowed: false, owner: 'retained-release', reason: retained.draft
      ? 'An existing draft owns this immutable version. Reconcile its owner and retained assets before any rebuild.'
      : 'This version is already published. Reuse its verified delivery evidence; no rebuild or publication is needed.' };
  }
  const current = await get(`/actions/runs/${env.GITHUB_RUN_ID}`);
  if (String(current.id) !== env.GITHUB_RUN_ID || current.run_attempt !== Number(env.GITHUB_RUN_ATTEMPT)
    || current.head_sha !== env.GITHUB_SHA || current.event !== 'workflow_dispatch' || current.status !== 'in_progress'
    || current.path !== '.github/workflows/windows-preview.yml') throw new Error('This execution is not the current assigned preview owner; stop before build.');
  return { buildAllowed: true, owner: 'current-workflow-run', reason: 'Current manual workflow owns this attempt; no retained release exists.',
    limitation: 'The hold is a job-start snapshot for future jobs. Before unpublished local work, obtain completion or authorized cancellation and explicit release of the active cloud owner; setting hold alone never authorizes overlap. This read-only check cannot observe an unregistered local process.' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const phase = process.argv[2] || 'initial';
  if (!['initial', 'before-frontend', 'before-native', 'before-publication'].includes(phase)) throw new Error('Use a supported release ownership checkpoint.');
  try {
    const result = await inspectPreviewOwnership();
    console.log(JSON.stringify({ phase, ...result, releaseWrites: 'not-performed' }, null, 2));
    if (phase === 'initial' && process.env.GITHUB_OUTPUT) writeFileSync(process.env.GITHUB_OUTPUT, `build_allowed=${result.buildAllowed}\n`, { flag: 'a' });
    if (!result.buildAllowed && phase !== 'initial') {
      console.error('::error::Release ownership changed or retained publication exists. Stop this attempt and reconcile the existing owner; do not rebuild, overwrite or republish.');
      process.exitCode = 1;
    }
  } catch {
    console.error('::error::Release ownership is unverified. Check the current run, release-owner hold and retained release before retrying this checkpoint. No release write was attempted.');
    process.exitCode = 1;
  }
}

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { githubReader, RELEASES_REPO } from './lib/github-read.mjs';

export const REQUIRED_PLATFORMS = ['windows-x86_64', 'linux-x86_64', 'darwin-aarch64', 'darwin-x86_64'];
export const DEFAULT_VERSIONS = ['1.0.77', '1.0.78', '1.0.79'];

export function decodeSignature(signature) {
  if (typeof signature !== 'string' || !signature.trim()) return null;
  let text;
  try { text = Buffer.from(signature, 'base64').toString('utf8'); } catch { return null; }
  const lines = text.split('\n');
  if (!lines[0]?.startsWith('untrusted comment:') || !lines[2]?.startsWith('trusted comment:')) return null;
  const file = /\bfile:([^\t\n]+)/.exec(lines[2])?.[1]?.trim() ?? null;
  return { file, text };
}

export function assetNameFromUrl(url, tag) {
  const match = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/releases\/download\/([^/]+)\/([^/?#]+)$/.exec(url || '');
  if (!match) return { error: `not a GitHub release download URL: ${url}` };
  if (match[1] !== RELEASES_REPO) return { error: `points at another repository: ${match[1]}` };
  if (match[2] !== tag) return { error: `points at tag ${match[2]}, not ${tag}` };
  return { name: decodeURIComponent(match[3]) };
}

export async function checkRelease(version, release, readText) {
  const tag = `v${version}`;
  const findings = [];
  const fail = message => findings.push({ level: 'fail', message });
  const pass = message => findings.push({ level: 'pass', message });
  if (!release) {
    fail(`${tag}: no release exists`);
    return { version, ok: false, state: 'missing', findings };
  }
  const state = release.draft ? 'draft' : release.prerelease ? 'prerelease' : 'published';
  const assets = new Map((release.assets || []).map(asset => [asset.name, asset]));
  const manifestAsset = assets.get('latest.json');
  if (!manifestAsset) {
    fail(`${tag} (${state}, ${assets.size} assets): no latest.json, so no updater manifest exists for this version`);
    return { version, ok: false, state, findings };
  }
  let manifest;
  try { manifest = JSON.parse(await readText(manifestAsset)); } catch (error) {
    fail(`${tag}: latest.json is not readable JSON (${error.message})`);
    return { version, ok: false, state, findings };
  }
  manifest.version === version ? pass(`version is ${version}`) : fail(`manifest version ${manifest.version} does not match ${version}`);
  Number.isNaN(Date.parse(manifest.pub_date)) ? fail('pub_date is not a date') : pass(`pub_date ${manifest.pub_date}`);
  typeof manifest.notes === 'string' && manifest.notes.trim() ? pass('notes present') : fail('notes missing');
  const platforms = manifest.platforms || {};
  for (const platform of REQUIRED_PLATFORMS) if (!platforms[platform]) fail(`platform ${platform} is missing`);
  for (const [platform, entry] of Object.entries(platforms)) {
    const target = assetNameFromUrl(entry.url, tag);
    if (target.error) { fail(`${platform}: url ${target.error}`); continue; }
    const asset = assets.get(target.name);
    if (!asset) { fail(`${platform}: ${target.name} is not an asset of ${tag}`); continue; }
    if (asset.state && asset.state !== 'uploaded') fail(`${platform}: ${target.name} is ${asset.state}, not uploaded`);
    if (!target.name.includes(version) && !/\.app\.tar\.gz$/.test(target.name)) fail(`${platform}: ${target.name} does not carry ${version} in its name`);
    const decoded = decodeSignature(entry.signature);
    if (!decoded) { fail(`${platform}: signature missing or not a minisign signature`); continue; }
    if (decoded.file && decoded.file !== target.name) fail(`${platform}: signature was made for ${decoded.file}, not ${target.name}`);
    const sigAsset = assets.get(`${target.name}.sig`);
    if (!sigAsset) { fail(`${platform}: ${target.name}.sig is not published beside it`); continue; }
    const published = (await readText(sigAsset)).trim();
    published === entry.signature.trim() ? pass(`${platform}: ${target.name} exists and its signature matches ${target.name}.sig`)
      : fail(`${platform}: manifest signature differs from ${target.name}.sig`);
  }
  return { version, ok: !findings.some(f => f.level === 'fail'), state, findings };
}

export async function checkManifests(versions, releases, readText) {
  const byTag = new Map(releases.map(release => [release.tag_name, release]));
  const results = [];
  for (const version of versions) results.push(await checkRelease(version, byTag.get(`v${version}`), readText));
  return results;
}

export function formatResults(results) {
  const lines = [];
  for (const result of results) {
    lines.push(`${result.ok ? 'PASS' : 'FAIL'} v${result.version} (${result.state})`);
    for (const finding of result.findings) lines.push(`  ${finding.level === 'fail' ? 'x' : 'ok'} ${finding.message}`);
  }
  return lines.join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const versions = process.argv.slice(2).filter(v => /^\d+\.\d+\.\d+$/.test(v));
  const github = githubReader();
  const releases = await github.pages(`/repos/${RELEASES_REPO}/releases`);
  const results = await checkManifests(versions.length ? versions : DEFAULT_VERSIONS, releases, github.assetText);
  console.log(formatResults(results));
  const latest = await github.json(`/repos/${RELEASES_REPO}/releases/latest`).catch(() => null);
  if (latest) console.log(`\nGitHub's "latest" release is ${latest.tag_name}${(latest.assets || []).some(a => a.name === 'latest.json') ? '' : ', which has no latest.json: any /releases/latest/download/latest.json link 404s'}.`);
  if (results.some(result => !result.ok)) process.exitCode = 1;
}

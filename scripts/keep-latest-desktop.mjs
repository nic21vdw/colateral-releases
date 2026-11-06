import { pathToFileURL } from 'node:url';

export const RELEASES_REPO = 'nic21vdw/colateral-releases';
const STABLE_TAG = /^v(\d+)\.(\d+)\.(\d+)$/;

const parts = tag => STABLE_TAG.exec(tag)?.slice(1).map(Number) ?? null;
const newer = (a, b) => {
  for (let i = 0; i < 3; i += 1) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
};

export function newestDesktopRelease(releases) {
  let best = null;
  for (const release of releases) {
    const version = parts(release.tag_name);
    if (!version || release.draft || release.prerelease) continue;
    if (!release.assets?.some(asset => asset.name === 'latest.json')) continue;
    if (!best || newer(version, best.version)) best = { release, version };
  }
  return best?.release ?? null;
}

export function latestDecision(releases, currentLatestTag) {
  const target = newestDesktopRelease(releases);
  if (!target) return { action: 'none', reason: 'no published desktop release carries latest.json' };
  if (target.tag_name === currentLatestTag) return { action: 'none', reason: `${target.tag_name} is already latest`, tag: target.tag_name };
  return { action: 'set', tag: target.tag_name, id: target.id, from: currentLatestTag ?? null };
}

async function main() {
  const token = process.env.GH_TOKEN;
  if (!token) throw new Error('GH_TOKEN is required');
  const repo = process.env.RELEASES_REPO || RELEASES_REPO;
  const dryRun = process.argv.includes('--dry-run');
  const api = async (path, init = {}) => {
    const response = await fetch(`https://api.github.com/repos/${repo}/${path}`, {
      ...init,
      headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${token}`, 'x-github-api-version': '2022-11-28', ...init.headers },
      signal: AbortSignal.timeout(30000),
    });
    if (response.status === 404 && path === 'releases/latest') return null;
    if (!response.ok) throw new Error(`${init.method ?? 'GET'} ${path}: HTTP ${response.status}`);
    return response.json();
  };
  const releases = [];
  for (let page = 1; page <= 10; page += 1) {
    const batch = await api(`releases?per_page=100&page=${page}`);
    releases.push(...batch);
    if (batch.length < 100) break;
  }
  const current = (await api('releases/latest'))?.tag_name ?? null;
  const decision = latestDecision(releases, current);
  console.log(JSON.stringify({ current, ...decision, dryRun }));
  if (decision.action !== 'set' || dryRun) return;
  await api(`releases/${decision.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ make_latest: 'true' }) });
  const after = (await api('releases/latest'))?.tag_name;
  if (after !== decision.tag) throw new Error(`latest is ${after} after setting ${decision.tag}`);
  console.log(`latest: ${current} -> ${after}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch(error => { console.error(error.message); process.exit(1); });
}

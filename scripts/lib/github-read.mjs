export const RELEASES_REPO = 'nic21vdw/colateral-releases';
export const SOURCE_REPO = 'nic21vdw/CoLateral-AI';

export function githubReader({ fetchImpl = fetch, token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN } = {}) {
  const headers = { accept: 'application/vnd.github+json', 'user-agent': 'colateral-releases-tooling' };
  if (token) headers.authorization = `Bearer ${token}`;

  async function request(url, accept) {
    if (!url.startsWith('https://api.github.com/') && !url.startsWith('https://github.com/')) throw new Error(`Refusing to read outside GitHub: ${url}`);
    const response = await fetchImpl(url, { method: 'GET', headers: accept ? { ...headers, accept } : headers, signal: AbortSignal.timeout(30000) });
    if (!response.ok) {
      const error = new Error(`GET ${url} answered ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return response;
  }

  async function json(path) {
    return (await request(path.startsWith('https://') ? path : `https://api.github.com${path}`)).json();
  }

  async function pages(path, { perPage = 100, limit = 2000, pick = data => data } = {}) {
    const items = [];
    for (let page = 1; items.length < limit; page++) {
      const sep = path.includes('?') ? '&' : '?';
      const batch = pick(await json(`${path}${sep}per_page=${perPage}&page=${page}`));
      if (!Array.isArray(batch)) throw new Error(`Expected a list from ${path}`);
      items.push(...batch);
      if (batch.length < perPage) break;
    }
    return items;
  }

  async function assetText(asset) {
    const response = await request(asset.url, 'application/octet-stream');
    return response.text();
  }

  return { json, pages, assetText };
}

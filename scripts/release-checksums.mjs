import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { githubReader, RELEASES_REPO } from './lib/github-read.mjs';

export const SUMS_FILE = 'SHA256SUMS';
export const isChecksumFile = name => name === SUMS_FILE || name.endsWith('.sha256');
export const checksumLine = (hex, name) => `${hex}  ${name}\n`;

export function parseChecksumFile(text) {
  const entries = new Map();
  for (const line of String(text).split(/\r?\n/)) {
    if (!line.trim()) continue;
    const match = /^([a-fA-F0-9]{64}) [ *](.+)$/.exec(line.trim());
    if (!match) throw new Error(`Malformed checksum line: ${line.slice(0, 80)}`);
    entries.set(match[2], match[1].toLowerCase());
  }
  return entries;
}

export function generateChecksums(dir) {
  const root = resolve(dir);
  const names = readdirSync(root).filter(name => !isChecksumFile(name) && statSync(join(root, name)).isFile()).sort();
  if (!names.length) throw new Error(`No release assets in ${root}`);
  const sums = names.map(name => [name, createHash('sha256').update(readFileSync(join(root, name))).digest('hex')]);
  for (const [name, hex] of sums) writeFileSync(join(root, `${name}.sha256`), checksumLine(hex, name));
  writeFileSync(join(root, SUMS_FILE), sums.map(([name, hex]) => checksumLine(hex, name)).join(''));
  return Object.fromEntries(sums);
}

export function compareVersions(a, b) {
  const pa = a.replace(/^v/, '').split('.').map(Number);
  const pb = b.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
}

export async function auditRelease(release, readText) {
  const assets = release.assets || [];
  const payloads = assets.filter(asset => !isChecksumFile(asset.name));
  const byName = new Map(assets.map(asset => [asset.name, asset]));
  let sums = new Map();
  if (byName.has(SUMS_FILE)) sums = parseChecksumFile(await readText(byName.get(SUMS_FILE)));
  const rows = [];
  for (const asset of payloads) {
    const digest = /^sha256:([a-f0-9]{64})$/.exec(asset.digest || '')?.[1] ?? null;
    const own = byName.get(`${asset.name}.sha256`);
    let published = sums.get(asset.name) ?? null;
    if (own) published = parseChecksumFile(await readText(own)).get(asset.name) ?? published;
    const state = !published ? 'missing' : !digest ? 'unverifiable' : published === digest ? 'ok' : 'mismatch';
    rows.push({ name: asset.name, state, digest });
  }
  return { tag: release.tag_name, draft: Boolean(release.draft), prerelease: Boolean(release.prerelease), rows };
}

export async function auditReleases(releases, readText, { from = null } = {}) {
  const reports = [];
  for (const release of releases) {
    if (release.draft || !/^v\d+\.\d+\.\d+$/.test(release.tag_name)) continue;
    if (from && compareVersions(release.tag_name, from) < 0) continue;
    reports.push(await auditRelease(release, readText));
  }
  const failing = reports.filter(report => report.rows.some(row => row.state !== 'ok'));
  return { ok: failing.length === 0, reports, failing: failing.map(report => report.tag) };
}

export function formatAudit(result) {
  const lines = [];
  for (const report of result.reports) {
    const counts = {};
    for (const row of report.rows) counts[row.state] = (counts[row.state] || 0) + 1;
    lines.push(`${report.tag}${report.prerelease ? ' (prerelease)' : ''}: ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ') || 'no assets'}`);
    for (const row of report.rows) if (row.state === 'mismatch') lines.push(`  MISMATCH ${row.name}`);
  }
  lines.push(result.ok ? 'Every published asset has a matching SHA-256 file.' : `Releases without complete checksums: ${result.failing.join(', ')}`);
  return lines.join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [mode, arg] = process.argv.slice(2);
  if (mode === 'generate' && arg) {
    const sums = generateChecksums(arg);
    for (const [name, hex] of Object.entries(sums)) console.log(checksumLine(hex, name).trimEnd());
    console.log(`Wrote ${Object.keys(sums).length} .sha256 files and ${SUMS_FILE}. Upload them beside the installers.`);
  } else if (mode === 'check') {
    const from = process.argv.find(value => value.startsWith('--from='))?.slice(7) ?? null;
    const github = githubReader();
    const releases = await github.pages(`/repos/${RELEASES_REPO}/releases`);
    const result = await auditReleases(releases, github.assetText, { from });
    console.log(formatAudit(result));
    if (!result.ok) process.exitCode = 1;
  } else {
    console.error('Usage: node scripts/release-checksums.mjs generate <asset-dir> | check [--from=v1.0.80]');
    process.exitCode = 2;
  }
}

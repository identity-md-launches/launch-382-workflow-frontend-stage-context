#!/usr/bin/env node
/**
 * Write dist/imd-deployment.json after `vite build`.
 *
 * - Copies each implementation-derived ABI (docs/abi/<Contract>.json at the pinned source commit)
 *   into dist/abi/ as a raw JSON array and verifies its canonical Keccak-256 hash against the handoff.
 * - Copies launchId, chainId, sourceCommit, attestationHash and the exact contract set from the
 *   handoff, and the `network` block from network.json byte for byte.
 * - Records the SHA-256 of every other exported file (index.html, assets, ABI JSON).
 *
 * Inputs are read from .imd/reads/ when present (the workflow handoff) and otherwise from the
 * committed copies in web/deployment/. Both copies must agree when both exist.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { keccak256, stringToBytes } from 'viem';

const here = dirname(fileURLToPath(import.meta.url));
const webDir = resolve(here, '..');
const repoDir = resolve(webDir, '..');
const distDir = resolve(repoDir, 'dist');
const abiSourceDir = resolve(repoDir, 'docs', 'abi');

const MAX_ASSETS = 128;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const EXPORT_BUDGET_BYTES = 24 * 1024 * 1024; // well under half the checker's 64 MiB body budget

function fail(msg) {
  console.error(`manifest: ${msg}`);
  process.exit(1);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function loadInput(name) {
  const handoffPath = resolve(repoDir, '.imd', 'reads', name);
  const committedPath = resolve(webDir, 'deployment', name === 'deployment.json' ? 'handoff.json' : name);
  const fromHandoff = existsSync(handoffPath) ? readFileSync(handoffPath, 'utf8') : null;
  const fromCommitted = existsSync(committedPath) ? readFileSync(committedPath, 'utf8') : null;
  if (!fromHandoff && !fromCommitted) fail(`neither ${handoffPath} nor ${committedPath} exists`);
  if (fromHandoff && fromCommitted && JSON.stringify(JSON.parse(fromHandoff)) !== JSON.stringify(JSON.parse(fromCommitted)))
    fail(`${handoffPath} and ${committedPath} disagree; update the committed copy from the handoff`);
  return JSON.parse(fromHandoff ?? fromCommitted);
}

/** Canonical JSON: object keys sorted recursively, no whitespace. */
function canonicalize(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalize(value[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function canonicalKeccak(value) {
  return keccak256(stringToBytes(canonicalize(value))).slice(2);
}

function sha256Hex(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

function walk(dir, base = dir) {
  const out = [];
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walk(full, base));
    else out.push(relative(base, full).split(sep).join('/'));
  }
  return out;
}

// --- inputs ---------------------------------------------------------------
const handoff = loadInput('deployment.json');
const networkFile = existsSync(resolve(repoDir, '.imd', 'reads', 'network.json')) || existsSync(resolve(webDir, 'deployment', 'network.json'))
  ? loadInput('network.json')
  : null;

if (!existsSync(resolve(distDir, 'index.html'))) fail('dist/index.html is missing; run `vite build` first');

// The Opened-event scan start must match the handoff deployment block.
const deploymentBlock = Math.min(...handoff.contracts.map((c) => c.blockNumber));
const blockSource = readFileSync(resolve(webDir, 'src', 'deploymentBlock.ts'), 'utf8');
const m = blockSource.match(/LOG_SCAN_START_BLOCK\s*=\s*(\d+)n/);
if (!m) fail('src/deploymentBlock.ts does not define LOG_SCAN_START_BLOCK');
if (Number(m[1]) !== deploymentBlock)
  fail(`src/deploymentBlock.ts LOG_SCAN_START_BLOCK=${m[1]} but the handoff deployment block is ${deploymentBlock}`);

if (networkFile && networkFile.network.chainId !== handoff.chainId)
  fail(`network.json chainId ${networkFile.network.chainId} differs from handoff chainId ${handoff.chainId}`);

// --- ABIs -----------------------------------------------------------------
mkdirSync(resolve(distDir, 'abi'), { recursive: true });
const contracts = handoff.contracts.map((c) => {
  const src = resolve(abiSourceDir, `${c.name}.json`);
  if (!existsSync(src)) fail(`ABI export ${src} not found`);
  const abi = readJson(src);
  if (!Array.isArray(abi)) fail(`${src} is not a JSON array`);
  const hash = canonicalKeccak(abi);
  if (hash !== c.abiHash) fail(`ABI hash mismatch for ${c.name}: computed ${hash}, handoff ${c.abiHash}`);
  const abiPath = `abi/${c.name}.json`;
  writeFileSync(resolve(distDir, abiPath), JSON.stringify(abi));
  return { name: c.name, address: c.address, abiHash: c.abiHash, abiPath };
});

// --- assets ---------------------------------------------------------------
const files = walk(distDir).filter((p) => p !== 'imd-deployment.json');
let total = 0;
const assets = files.map((path) => {
  const buf = readFileSync(resolve(distDir, path));
  if (buf.length > MAX_FILE_BYTES) fail(`${path} is ${buf.length} bytes, over the 8 MiB per-file limit`);
  total += buf.length;
  return { path, sha256: sha256Hex(buf) };
});
if (assets.length > MAX_ASSETS) fail(`${assets.length} assets, over the limit of ${MAX_ASSETS}`);
if (total > EXPORT_BUDGET_BYTES) fail(`export is ${total} bytes, over the ${EXPORT_BUDGET_BYTES} byte budget`);
if (!assets.some((a) => a.path === 'index.html')) fail('index.html missing from asset list');
for (const c of contracts) if (!assets.some((a) => a.path === c.abiPath)) fail(`${c.abiPath} missing from asset list`);

// --- manifest -------------------------------------------------------------
const manifest = {
  version: 1,
  launchId: handoff.launchId,
  chainId: handoff.chainId,
  sourceCommit: handoff.sourceCommit,
  attestationHash: handoff.attestationHash,
  contracts,
  assets,
  ...(networkFile ? { network: networkFile.network } : {}),
};
writeFileSync(resolve(distDir, 'imd-deployment.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(
  `manifest: wrote dist/imd-deployment.json with ${contracts.length} contracts and ${assets.length} assets (${total} bytes)`,
);

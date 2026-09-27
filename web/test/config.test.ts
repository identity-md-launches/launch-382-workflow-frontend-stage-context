import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { keccak256, stringToBytes } from 'viem';
import { validateManifest, walletAddChainFromNetwork, type NetworkBlock } from '../src/config';
import { LOG_SCAN_START_BLOCK } from '../src/deploymentBlock';

const root = resolve(__dirname, '..', '..');
const handoff = JSON.parse(readFileSync(resolve(root, 'web/deployment/handoff.json'), 'utf8'));
const networkFile = JSON.parse(readFileSync(resolve(root, 'web/deployment/network.json'), 'utf8'));

function canonicalize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalize(o[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

describe('deployment handoff inputs', () => {
  it('ABI exports at docs/abi hash to the handoff abiHash', () => {
    for (const c of handoff.contracts) {
      const abi = JSON.parse(readFileSync(resolve(root, 'docs/abi', `${c.name}.json`), 'utf8'));
      expect(keccak256(stringToBytes(canonicalize(abi))).slice(2)).toBe(c.abiHash);
    }
  });
  it('log scan start block equals the handoff deployment block', () => {
    const block = Math.min(...handoff.contracts.map((c: { blockNumber: number }) => c.blockNumber));
    expect(Number(LOG_SCAN_START_BLOCK)).toBe(block);
  });
  it('wallet_addEthereumChain parameters derived from the network block equal the pinned walletAddChain', () => {
    expect(walletAddChainFromNetwork(networkFile.network as NetworkBlock)).toEqual(networkFile.walletAddChain);
  });
});

describe('validateManifest', () => {
  const good = {
    version: 1,
    launchId: handoff.launchId,
    chainId: handoff.chainId,
    sourceCommit: handoff.sourceCommit,
    attestationHash: handoff.attestationHash,
    contracts: handoff.contracts.map((c: { name: string; address: string; abiHash: string }) => ({
      name: c.name,
      address: c.address,
      abiHash: c.abiHash,
      abiPath: `abi/${c.name}.json`,
    })),
    assets: [{ path: 'index.html', sha256: 'a'.repeat(64) }],
    network: networkFile.network,
  };
  it('accepts a manifest shaped like the export', () => {
    expect(validateManifest(good).launchId).toBe(handoff.launchId);
  });
  it('accepts the committed dist manifest when present', () => {
    let text: string;
    try {
      text = readFileSync(resolve(root, 'dist/imd-deployment.json'), 'utf8');
    } catch {
      return; // not built yet
    }
    const m = validateManifest(JSON.parse(text));
    expect(m.contracts.map((c) => c.name).sort()).toEqual(['AllowanceWallet', 'LaunchToken']);
    expect(m.assets.some((a) => a.path === 'index.html')).toBe(true);
    expect(m.assets.some((a) => a.path === 'imd-deployment.json')).toBe(false);
    expect(m.network).toEqual(networkFile.network);
  });
  it('rejects parent traversal, absolute paths and URLs in abiPath and asset paths', () => {
    for (const bad of ['../abi/x.json', '/abi/x.json', 'https://example.com/x.json', 'abi/../../x.json']) {
      expect(() => validateManifest({ ...good, contracts: [{ ...good.contracts[0], abiPath: bad }] })).toThrow();
      expect(() => validateManifest({ ...good, assets: [{ path: bad, sha256: 'a'.repeat(64) }] })).toThrow();
    }
  });
  it('rejects wrong version, bad hashes and a network block on another chain', () => {
    expect(() => validateManifest({ ...good, version: 2 })).toThrow();
    expect(() => validateManifest({ ...good, attestationHash: 'ZZ' })).toThrow();
    expect(() => validateManifest({ ...good, contracts: [{ ...good.contracts[0], abiHash: '0x' + 'a'.repeat(64) }] })).toThrow();
    expect(() => validateManifest({ ...good, network: { ...networkFile.network, chainId: 1 } })).toThrow();
  });
});

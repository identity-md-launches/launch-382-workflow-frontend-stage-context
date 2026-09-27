import { describe, expect, it, vi } from 'vitest';
import { isUnknownChainError, isUserRejection, parseChainId, switchOrAddChain, type Eip1193Provider } from '../src/wallet';
import type { WalletAddChainParams } from '../src/config';

const addParams: WalletAddChainParams = {
  chainId: '0xaa36a7',
  chainName: 'Sepolia',
  rpcUrls: ['https://ethereum-sepolia-rpc.publicnode.com'],
  nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
  blockExplorerUrls: ['https://sepolia.etherscan.io'],
};

function providerWith(handler: (method: string, params: unknown) => unknown): Eip1193Provider & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async request({ method, params }) {
      calls.push(method);
      return handler(method, params);
    },
  };
}

describe('switchOrAddChain', () => {
  it('switches directly when the wallet knows the chain', async () => {
    const p = providerWith(() => null);
    await expect(switchOrAddChain(p, 11155111, addParams)).resolves.toBe('switched');
    expect(p.calls).toEqual(['wallet_switchEthereumChain']);
  });

  it('offers wallet_addEthereumChain with the network parameters after a 4902 and switches again', async () => {
    let known = false;
    const seen: unknown[] = [];
    const p = providerWith((method, params) => {
      if (method === 'wallet_switchEthereumChain' && !known) throw Object.assign(new Error('Unrecognized chain ID'), { code: 4902 });
      if (method === 'wallet_addEthereumChain') {
        seen.push((params as unknown[])[0]);
        known = true;
      }
      return null;
    });
    await expect(switchOrAddChain(p, 11155111, addParams)).resolves.toBe('added');
    expect(p.calls).toEqual(['wallet_switchEthereumChain', 'wallet_addEthereumChain', 'wallet_switchEthereumChain']);
    expect(seen[0]).toEqual(addParams);
  });

  it('propagates a user rejection of the switch and does not add the chain', async () => {
    const p = providerWith((method) => {
      if (method === 'wallet_switchEthereumChain') throw Object.assign(new Error('User rejected the request.'), { code: 4001 });
      return null;
    });
    await expect(switchOrAddChain(p, 11155111, addParams)).rejects.toMatchObject({ code: 4001 });
    expect(p.calls).toEqual(['wallet_switchEthereumChain']);
  });

  it('rethrows an unknown-chain error when there are no add parameters', async () => {
    const p = providerWith(() => {
      throw Object.assign(new Error('Unrecognized chain ID'), { code: 4902 });
    });
    await expect(switchOrAddChain(p, 11155111, null)).rejects.toMatchObject({ code: 4902 });
  });
});

describe('error classification', () => {
  it('recognises wallet error codes and messages', () => {
    expect(isUserRejection({ code: 4001 })).toBe(true);
    expect(isUserRejection(new Error('User rejected the request'))).toBe(true);
    expect(isUserRejection(new Error('nope'))).toBe(false);
    expect(isUnknownChainError({ code: 4902 })).toBe(true);
    expect(isUnknownChainError({ data: { originalError: { code: 4902 } } })).toBe(true);
    expect(isUnknownChainError(new Error('Unrecognized chain ID "0xaa36a7"'))).toBe(true);
    expect(isUnknownChainError({ code: 4001 })).toBe(false);
  });
  it('parses hex and numeric chain ids', () => {
    expect(parseChainId('0xaa36a7')).toBe(11155111);
    expect(parseChainId(1)).toBe(1);
    expect(parseChainId(undefined)).toBeNull();
  });
  const _ = vi;
  void _;
});

/**
 * Browser-wallet access over EIP-1193 with EIP-6963 discovery. No WalletConnect project id is
 * required; every injected wallet (MetaMask, Rabby, Coinbase Wallet, …) is offered.
 */
import type { Hex } from 'viem';
import type { WalletAddChainParams } from './config';

export interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] | Record<string, unknown> }): Promise<unknown>;
  on?(event: string, listener: (...args: unknown[]) => void): void;
  removeListener?(event: string, listener: (...args: unknown[]) => void): void;
}

export interface WalletOption {
  id: string;
  name: string;
  icon: string | null;
  provider: Eip1193Provider;
}

interface Eip6963Detail {
  info: { uuid: string; name: string; icon: string; rdns: string };
  provider: Eip1193Provider;
}

declare global {
  interface Window {
    ethereum?: Eip1193Provider & { providers?: Eip1193Provider[] };
  }
  interface WindowEventMap {
    'eip6963:announceProvider': CustomEvent<Eip6963Detail>;
  }
}

/** Discover injected wallets. Resolves after a short announcement window. */
export function discoverWallets(timeoutMs = 300): Promise<WalletOption[]> {
  return new Promise((resolve) => {
    const found = new Map<string, WalletOption>();
    const onAnnounce = (event: CustomEvent<Eip6963Detail>) => {
      const { info, provider } = event.detail;
      if (!found.has(info.rdns)) found.set(info.rdns, { id: info.rdns, name: info.name, icon: info.icon, provider });
    };
    window.addEventListener('eip6963:announceProvider', onAnnounce);
    window.dispatchEvent(new Event('eip6963:requestProvider'));
    setTimeout(() => {
      window.removeEventListener('eip6963:announceProvider', onAnnounce);
      if (found.size === 0 && window.ethereum) {
        found.set('injected', { id: 'injected', name: 'Browser wallet', icon: null, provider: window.ethereum });
      }
      resolve([...found.values()]);
    }, timeoutMs);
  });
}

export function parseChainId(value: unknown): number | null {
  if (typeof value === 'string') return Number.parseInt(value, 16);
  if (typeof value === 'number') return value;
  return null;
}

export interface ProviderRpcError extends Error {
  code?: number;
  data?: { originalError?: { code?: number } };
}

function errorCode(e: unknown): number | undefined {
  const err = e as ProviderRpcError | undefined;
  return err?.code ?? err?.data?.originalError?.code;
}

export function isUserRejection(e: unknown): boolean {
  if (errorCode(e) === 4001) return true;
  const msg = (e as Error)?.message?.toLowerCase() ?? '';
  return msg.includes('user rejected') || msg.includes('user denied');
}

/** Does this error mean the wallet does not know the chain (EIP-3085 unrecognised chain)? */
export function isUnknownChainError(e: unknown): boolean {
  if (errorCode(e) === 4902) return true;
  const msg = (e as Error)?.message?.toLowerCase() ?? '';
  return msg.includes('unrecognized chain') || msg.includes('unknown chain') || msg.includes('not added');
}

/**
 * Switch the wallet to the target chain. When the wallet reports an unknown chain, offer
 * `wallet_addEthereumChain` with the network parameters and switch again.
 */
export async function switchOrAddChain(
  provider: Eip1193Provider,
  chainId: number,
  addParams: WalletAddChainParams | null,
): Promise<'switched' | 'added'> {
  const hexId: Hex = `0x${chainId.toString(16)}`;
  try {
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hexId }] });
    return 'switched';
  } catch (e) {
    if (!isUnknownChainError(e) || !addParams) throw e;
  }
  await provider.request({ method: 'wallet_addEthereumChain', params: [addParams] });
  // Some wallets switch as part of adding; asking again is harmless and covers the ones that do not.
  try {
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hexId }] });
  } catch (e) {
    if (isUserRejection(e)) throw e;
  }
  return 'added';
}

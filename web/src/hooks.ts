import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getAddress, type Address, type PublicClient } from 'viem';
import { loadDeployment, type Deployment } from './config';
import {
  checkDeploymentIntegrity,
  createReadClient,
  readAccount,
  readTokenInfo,
  readWalletTokenState,
  scanActivity,
  scanOpened,
  type AccountView,
  type ActivityEvent,
  type IntegrityResult,
  type OpenedEvent,
  type TokenInfo,
  type WalletTokenState,
} from './chain';
import { describeError } from './chain';
import { discoverWallets, parseChainId, switchOrAddChain, type Eip1193Provider, type WalletOption } from './wallet';
import { LOG_SCAN_START_BLOCK } from './deploymentBlock';

// ---------------------------------------------------------------------------
// Deployment configuration and read client
// ---------------------------------------------------------------------------

export type DeploymentState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | {
      status: 'ready';
      deployment: Deployment;
      client: PublicClient;
      token: TokenInfo | null;
      integrity: IntegrityResult | null;
      rpcError: string | null;
    };

export function useDeployment(): DeploymentState {
  const [state, setState] = useState<DeploymentState>({ status: 'loading' });
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let deployment: Deployment;
      try {
        deployment = await loadDeployment();
      } catch (e) {
        if (!cancelled) setState({ status: 'error', message: describeError(e) });
        return;
      }
      const client = createReadClient(deployment);
      if (cancelled) return;
      setState({ status: 'ready', deployment, client, token: null, integrity: null, rpcError: null });
      try {
        const [integrity, token] = await Promise.all([
          checkDeploymentIntegrity(client, deployment),
          readTokenInfo(client, deployment).catch(() => null),
        ]);
        if (!cancelled) setState({ status: 'ready', deployment, client, token, integrity, rpcError: null });
      } catch (e) {
        if (!cancelled)
          setState({ status: 'ready', deployment, client, token: null, integrity: null, rpcError: describeError(e) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return state;
}

// ---------------------------------------------------------------------------
// Wallet connection
// ---------------------------------------------------------------------------

export interface WalletState {
  wallets: WalletOption[];
  discovered: boolean;
  selected: WalletOption | null;
  provider: Eip1193Provider | null;
  address: Address | null;
  chainId: number | null;
  connecting: boolean;
  switching: boolean;
  error: string | null;
  connect: (option: WalletOption) => Promise<void>;
  disconnect: () => void;
  switchChain: () => Promise<void>;
}

export function useWallet(deployment: Deployment | null): WalletState {
  const [wallets, setWallets] = useState<WalletOption[]>([]);
  const [discovered, setDiscovered] = useState(false);
  const [selected, setSelected] = useState<WalletOption | null>(null);
  const [address, setAddress] = useState<Address | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    discoverWallets().then((list) => {
      if (cancelled) return;
      setWallets(list);
      setDiscovered(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const provider = selected?.provider ?? null;

  useEffect(() => {
    if (!provider?.on || !provider.removeListener) return;
    const onAccounts = (...args: unknown[]) => {
      const accounts = args[0] as string[];
      setAddress(accounts.length ? getAddress(accounts[0]) : null);
    };
    const onChain = (...args: unknown[]) => setChainId(parseChainId(args[0]));
    const onDisconnect = () => {
      setAddress(null);
    };
    provider.on('accountsChanged', onAccounts);
    provider.on('chainChanged', onChain);
    provider.on('disconnect', onDisconnect);
    return () => {
      provider.removeListener?.('accountsChanged', onAccounts);
      provider.removeListener?.('chainChanged', onChain);
      provider.removeListener?.('disconnect', onDisconnect);
    };
  }, [provider]);

  const connect = useCallback(async (option: WalletOption) => {
    setConnecting(true);
    setError(null);
    try {
      const accounts = (await option.provider.request({ method: 'eth_requestAccounts' })) as string[];
      const hex = (await option.provider.request({ method: 'eth_chainId' })) as string;
      setSelected(option);
      setAddress(accounts.length ? getAddress(accounts[0]) : null);
      setChainId(parseChainId(hex));
    } catch (e) {
      setError(describeError(e));
    } finally {
      setConnecting(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    setSelected(null);
    setAddress(null);
    setChainId(null);
    setError(null);
  }, []);

  const switchChain = useCallback(async () => {
    if (!provider || !deployment) return;
    setSwitching(true);
    setError(null);
    try {
      await switchOrAddChain(provider, deployment.chainId, deployment.walletAddChain);
      const hex = (await provider.request({ method: 'eth_chainId' })) as string;
      setChainId(parseChainId(hex));
    } catch (e) {
      setError(describeError(e));
    } finally {
      setSwitching(false);
    }
  }, [provider, deployment]);

  return {
    wallets,
    discovered,
    selected,
    provider,
    address,
    chainId,
    connecting,
    switching,
    error,
    connect,
    disconnect,
    switchChain,
  };
}

// ---------------------------------------------------------------------------
// Accounts built from Opened events plus live views
// ---------------------------------------------------------------------------

export interface AccountsState {
  status: 'idle' | 'scanning' | 'reading' | 'ready' | 'error';
  scannedTo: bigint | null;
  latestBlock: bigint | null;
  parentAccounts: AccountView[];
  childAccounts: AccountView[];
  opened: OpenedEvent[];
  activity: ActivityEvent[];
  walletToken: WalletTokenState | null;
  error: string | null;
  lastUpdated: number | null;
  refresh: () => Promise<void>;
}

const REFRESH_INTERVAL_MS = 30_000;

export function useAccounts(
  client: PublicClient | null,
  deployment: Deployment | null,
  address: Address | null,
  enabled: boolean,
): AccountsState {
  const [status, setStatus] = useState<AccountsState['status']>('idle');
  const [scannedTo, setScannedTo] = useState<bigint | null>(null);
  const [latestBlock, setLatestBlock] = useState<bigint | null>(null);
  const [opened, setOpened] = useState<OpenedEvent[]>([]);
  const [parentAccounts, setParentAccounts] = useState<AccountView[]>([]);
  const [childAccounts, setChildAccounts] = useState<AccountView[]>([]);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [walletToken, setWalletToken] = useState<WalletTokenState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const cache = useRef<{ address: Address; scannedTo: bigint; opened: OpenedEvent[]; activity: ActivityEvent[] } | null>(null);
  // Every address change starts a new generation; a refresh from an older generation never
  // writes its results, and never blocks the new address's first scan.
  const generation = useRef(0);
  const inFlight = useRef<{ gen: number; promise: Promise<void> } | null>(null);

  const refresh = useCallback(async () => {
    if (!client || !deployment || !address || !enabled) return;
    const gen = generation.current;
    if (inFlight.current && inFlight.current.gen === gen) return inFlight.current.promise;
    const live = () => generation.current === gen;
    const run = (async () => {
      try {
        // No cache: a refresh right after a confirmed transaction must see that block.
        const latest = await client.getBlockNumber({ cacheTime: 0 });
        if (!live()) return;
        setLatestBlock(latest);
        const prior = cache.current?.address === address ? cache.current : null;
        // A chain shorter than the deployment block (a local test chain) is scanned from genesis.
        const scanStart = LOG_SCAN_START_BLOCK <= latest ? LOG_SCAN_START_BLOCK : 0n;
        const fromBlock = prior ? prior.scannedTo + 1n : scanStart;
        let openedAll = prior ? prior.opened : [];
        let activityAll = prior ? prior.activity : [];
        if (fromBlock <= latest) {
          setStatus(prior ? 'reading' : 'scanning');
          const opts = { fromBlock, toBlock: latest, onProgress: (b: bigint) => setScannedTo(b) };
          const [asParent, asChild] = await Promise.all([
            scanOpened(client, deployment, { parent: address }, opts),
            scanOpened(client, deployment, { child: address }, opts),
          ]);
          if (!live()) return;
          const seen = new Set(openedAll.map((o) => o.id));
          for (const ev of [...asParent, ...asChild]) {
            if (!seen.has(ev.id)) {
              seen.add(ev.id);
              openedAll = [...openedAll, ev];
            }
          }
          openedAll.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
          const ids = openedAll.map((o) => o.id);
          // An account cannot have activity before its Opened event, so scanning activity over the
          // same range never misses anything. Merge and dedupe by tx hash + log index.
          const newActivity = await scanActivity(client, deployment, ids, { fromBlock, toBlock: latest });
          if (!live()) return;
          const key = (a: ActivityEvent) => `${a.txHash}:${a.logIndex}`;
          const seenActivity = new Set(activityAll.map(key));
          for (const a of newActivity) if (!seenActivity.has(key(a))) activityAll = [...activityAll, a];
          activityAll.sort((a, b) =>
            a.blockNumber === b.blockNumber ? b.logIndex - a.logIndex : a.blockNumber < b.blockNumber ? 1 : -1,
          );
          cache.current = { address, scannedTo: latest, opened: openedAll, activity: activityAll };
          setScannedTo(latest);
          setOpened(openedAll);
          setActivity(activityAll);
        }
        setStatus('reading');
        const [views, tokenState] = await Promise.all([
          Promise.all(openedAll.map((o) => readAccount(client, deployment, o.id))),
          readWalletTokenState(client, deployment, address),
        ]);
        if (!live()) return;
        const lower = address.toLowerCase();
        setParentAccounts(views.filter((v) => v.parent.toLowerCase() === lower));
        setChildAccounts(views.filter((v) => v.child.toLowerCase() === lower));
        setWalletToken(tokenState);
        setError(null);
        setStatus('ready');
        setLastUpdated(Date.now());
      } catch (e) {
        if (!live()) return;
        setError(describeError(e));
        setStatus('error');
      } finally {
        if (inFlight.current?.gen === gen) inFlight.current = null;
      }
    })();
    inFlight.current = { gen, promise: run };
    return run;
  }, [client, deployment, address, enabled]);

  // Reset when the address changes; scan from the deployment block for the new address.
  useEffect(() => {
    generation.current += 1;
    cache.current = null;
    setOpened([]);
    setParentAccounts([]);
    setChildAccounts([]);
    setActivity([]);
    setWalletToken(null);
    setScannedTo(null);
    setError(null);
    setStatus(address && enabled ? 'scanning' : 'idle');
    if (address && enabled) void refresh();
  }, [address, enabled, refresh]);

  useEffect(() => {
    if (!address || !enabled) return;
    const id = window.setInterval(() => void refresh(), REFRESH_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [address, enabled, refresh]);

  return useMemo(
    () => ({
      status,
      scannedTo,
      latestBlock,
      parentAccounts,
      childAccounts,
      opened,
      activity,
      walletToken,
      error,
      lastUpdated,
      refresh,
    }),
    [status, scannedTo, latestBlock, parentAccounts, childAccounts, opened, activity, walletToken, error, lastUpdated, refresh],
  );
}

/** Current unix time in seconds, ticking once a minute (enough for "resets in 2d 4h 10m"). */
export function useNowSeconds(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const id = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

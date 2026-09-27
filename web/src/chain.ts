/**
 * Read-side helpers: a viem public client over the configured public RPC URLs, contract
 * reads, and chunked `Opened` log scans from the deployment block. No backend, no indexer.
 */
import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  fallback,
  http,
  getAbiItem,
  type Abi,
  type AbiEvent,
  type Address,
  type PublicClient,
} from 'viem';
import { LOG_CHUNK_SIZE, type Deployment } from './config';

export function createReadClient(d: Deployment): PublicClient {
  return createPublicClient({
    chain: d.chain,
    transport: fallback(
      d.rpcUrls.map((url) => http(url, { timeout: 15_000, retryCount: 1 })),
      { rank: false },
    ),
    batch: { multicall: false },
  }) as unknown as PublicClient;
}

export interface AccountView {
  id: bigint;
  parent: Address;
  child: Address;
  allowance: bigint;
  balance: bigint;
  openedAt: bigint;
  remainingThisWindow: bigint;
  spentThisWindow: bigint;
  childWithdrawable: bigint;
  windowEndsAt: bigint;
  currentWindow: bigint;
}

export interface OpenedEvent {
  id: bigint;
  parent: Address;
  child: Address;
  weeklyAllowance: bigint;
  deposit: bigint;
  blockNumber: bigint;
  txHash: `0x${string}`;
}

export interface ActivityEvent {
  kind: 'Opened' | 'ToppedUp' | 'AllowanceSet' | 'ChildWithdrew' | 'ParentWithdrew';
  id: bigint;
  amount: bigint | null;
  newBalance: bigint | null;
  blockNumber: bigint;
  logIndex: number;
  txHash: `0x${string}`;
}

export async function readAccount(client: PublicClient, d: Deployment, id: bigint): Promise<AccountView> {
  const w = { address: d.wallet.address, abi: d.wallet.abi } as const;
  const [core, remaining, spent, withdrawable, endsAt, window] = await Promise.all([
    client.readContract({ ...w, functionName: 'account', args: [id] }) as Promise<
      readonly [Address, Address, bigint, bigint, bigint]
    >,
    client.readContract({ ...w, functionName: 'remainingThisWindow', args: [id] }) as Promise<bigint>,
    client.readContract({ ...w, functionName: 'spentThisWindow', args: [id] }) as Promise<bigint>,
    client.readContract({ ...w, functionName: 'childWithdrawable', args: [id] }) as Promise<bigint>,
    client.readContract({ ...w, functionName: 'windowEndsAt', args: [id] }) as Promise<bigint>,
    client.readContract({ ...w, functionName: 'currentWindow', args: [id] }) as Promise<bigint>,
  ]);
  return {
    id,
    parent: core[0],
    child: core[1],
    allowance: core[2],
    balance: core[3],
    openedAt: core[4],
    remainingThisWindow: remaining,
    spentThisWindow: spent,
    childWithdrawable: withdrawable,
    windowEndsAt: endsAt,
    currentWindow: window,
  };
}

export interface TokenInfo {
  symbol: string;
  decimals: number;
  name: string;
}

export async function readTokenInfo(client: PublicClient, d: Deployment): Promise<TokenInfo> {
  const t = { address: d.token.address, abi: d.token.abi } as const;
  const [symbol, decimals, name] = await Promise.all([
    client.readContract({ ...t, functionName: 'symbol' }) as Promise<string>,
    client.readContract({ ...t, functionName: 'decimals' }) as Promise<number>,
    client.readContract({ ...t, functionName: 'name' }) as Promise<string>,
  ]);
  return { symbol, decimals: Number(decimals), name };
}

export interface WalletTokenState {
  balance: bigint;
  /** ERC-20 allowance granted by the visitor to AllowanceWallet. */
  approved: bigint;
}

export async function readWalletTokenState(
  client: PublicClient,
  d: Deployment,
  owner: Address,
): Promise<WalletTokenState> {
  const t = { address: d.token.address, abi: d.token.abi } as const;
  const [balance, approved] = await Promise.all([
    client.readContract({ ...t, functionName: 'balanceOf', args: [owner] }) as Promise<bigint>,
    client.readContract({ ...t, functionName: 'allowance', args: [owner, d.wallet.address] }) as Promise<bigint>,
  ]);
  return { balance, approved };
}

/**
 * Deployment integrity: both addresses hold code on the configured chain, the chain id the RPC
 * reports matches the manifest, and `AllowanceWallet.token()` is the manifest's LaunchToken.
 * Transactions stay disabled until this passes.
 */
export interface IntegrityResult {
  ok: boolean;
  rpcChainId: number;
  walletHasCode: boolean;
  tokenHasCode: boolean;
  tokenFromWallet: Address | null;
  problems: string[];
}

export async function checkDeploymentIntegrity(client: PublicClient, d: Deployment): Promise<IntegrityResult> {
  const [rpcChainId, walletCode, tokenCode] = await Promise.all([
    client.getChainId(),
    client.getCode({ address: d.wallet.address }),
    client.getCode({ address: d.token.address }),
  ]);
  const walletHasCode = !!walletCode && walletCode !== '0x';
  const tokenHasCode = !!tokenCode && tokenCode !== '0x';
  let tokenFromWallet: Address | null = null;
  const problems: string[] = [];
  if (rpcChainId !== d.chainId) problems.push(`The RPC reports chain ${rpcChainId}, the manifest expects ${d.chainId}.`);
  if (!walletHasCode) problems.push('No contract code at the AllowanceWallet address.');
  if (!tokenHasCode) problems.push('No contract code at the LaunchToken address.');
  if (walletHasCode) {
    tokenFromWallet = (await client.readContract({
      address: d.wallet.address,
      abi: d.wallet.abi,
      functionName: 'token',
    })) as Address;
    if (tokenFromWallet.toLowerCase() !== d.token.address.toLowerCase())
      problems.push('AllowanceWallet.token() does not match the manifest LaunchToken address.');
  }
  return { ok: problems.length === 0, rpcChainId, walletHasCode, tokenHasCode, tokenFromWallet, problems };
}

function eventAbi(abi: Abi, name: string): AbiEvent {
  const item = getAbiItem({ abi, name }) as AbiEvent | undefined;
  if (!item || item.type !== 'event') throw new Error(`ABI has no event ${name}`);
  return item;
}

/** Iterate [from, to] in inclusive chunks of `size`. */
export function* blockRanges(from: bigint, to: bigint, size: bigint = LOG_CHUNK_SIZE): Generator<[bigint, bigint]> {
  let start = from;
  while (start <= to) {
    const end = start + size - 1n < to ? start + size - 1n : to;
    yield [start, end];
    start = end + 1n;
  }
}

export interface LogScanOptions {
  fromBlock: bigint;
  toBlock: bigint;
  chunkSize?: bigint;
  onProgress?: (scannedTo: bigint) => void;
}

/**
 * Chunked `Opened` scan filtered by indexed parent or child. Chunks halve automatically when
 * an RPC rejects a range as too large.
 */
export async function scanOpened(
  client: PublicClient,
  d: Deployment,
  filter: { parent?: Address; child?: Address },
  opts: LogScanOptions,
): Promise<OpenedEvent[]> {
  const event = eventAbi(d.wallet.abi, 'Opened');
  const out: OpenedEvent[] = [];
  const args: Record<string, Address> = {};
  if (filter.parent) args.parent = filter.parent;
  if (filter.child) args.child = filter.child;

  const fetchRange = async (from: bigint, to: bigint): Promise<void> => {
    try {
      const logs = await client.getLogs({ address: d.wallet.address, event, args, fromBlock: from, toBlock: to });
      for (const log of logs) {
        const a = log.args as { id: bigint; parent: Address; child: Address; weeklyAllowance: bigint; deposit: bigint };
        out.push({
          id: a.id,
          parent: a.parent,
          child: a.child,
          weeklyAllowance: a.weeklyAllowance,
          deposit: a.deposit,
          blockNumber: log.blockNumber ?? from,
          txHash: log.transactionHash ?? '0x',
        });
      }
    } catch (e) {
      if (to - from >= 1n) {
        const mid = from + (to - from) / 2n;
        await fetchRange(from, mid);
        await fetchRange(mid + 1n, to);
        return;
      }
      throw e;
    }
  };

  for (const [from, to] of blockRanges(opts.fromBlock, opts.toBlock, opts.chunkSize)) {
    await fetchRange(from, to);
    opts.onProgress?.(to);
  }
  return out;
}

const ACTIVITY_EVENTS = ['ToppedUp', 'AllowanceSet', 'ChildWithdrew', 'ParentWithdrew'] as const;

/** Chunked scan of the non-Opened account events for a set of account ids. */
export async function scanActivity(
  client: PublicClient,
  d: Deployment,
  ids: bigint[],
  opts: LogScanOptions,
): Promise<ActivityEvent[]> {
  if (ids.length === 0) return [];
  const events = ACTIVITY_EVENTS.map((n) => [n, eventAbi(d.wallet.abi, n)] as const);
  const out: ActivityEvent[] = [];
  const fetchRange = async (from: bigint, to: bigint): Promise<void> => {
    try {
      const perEvent = await Promise.all(
        events.map(([name, event]) =>
          client
            .getLogs({ address: d.wallet.address, event, args: { id: ids }, fromBlock: from, toBlock: to })
            .then((logs) => logs.map((log) => ({ name, log }))),
        ),
      );
      for (const { name, log } of perEvent.flat()) {
        const args = log.args as Record<string, bigint>;
        out.push({
          kind: name,
          id: args.id,
          amount: name === 'AllowanceSet' ? args.newAllowance : args.amount,
          newBalance: name === 'AllowanceSet' ? null : args.newBalance,
          blockNumber: log.blockNumber ?? from,
          logIndex: log.logIndex ?? 0,
          txHash: log.transactionHash ?? '0x',
        });
      }
    } catch (e) {
      if (to - from >= 1n) {
        const mid = from + (to - from) / 2n;
        await fetchRange(from, mid);
        await fetchRange(mid + 1n, to);
        return;
      }
      throw e;
    }
  };
  for (const [from, to] of blockRanges(opts.fromBlock, opts.toBlock, opts.chunkSize)) {
    await fetchRange(from, to);
    opts.onProgress?.(to);
  }
  return out;
}

/** Turn a viem/wallet error into a sentence a visitor can act on. */
export function describeError(e: unknown): string {
  if (e instanceof BaseError) {
    const revert = e.walk((err) => err instanceof ContractFunctionRevertedError) as
      | ContractFunctionRevertedError
      | null;
    if (revert?.data) {
      const name = revert.data.errorName;
      const args = (revert.data.args ?? []) as readonly unknown[];
      switch (name) {
        case 'NotParent':
          return 'Only the parent of this account can do that.';
        case 'NotChild':
          return 'Only the child of this account can withdraw from it.';
        case 'ZeroAmount':
          return 'Enter an amount greater than zero.';
        case 'ZeroChild':
          return 'Enter the child address.';
        case 'ChildIsCaller':
          return 'The child must be a different address from yours.';
        case 'NoSuchAccount':
          return 'That account does not exist.';
        case 'ExceedsAllowance':
          return `That is more than the remaining allowance this window (${String(args[2])} minor units left).`;
        case 'InsufficientBalance':
          return `That is more than the account balance (${String(args[2])} minor units available).`;
        case 'SafeERC20FailedOperation':
        case 'ERC20InsufficientAllowance':
          return 'The token transfer failed. Approve enough PCKT first, then try again.';
        case 'ERC20InsufficientBalance':
          return 'Your PCKT balance is too low for this amount.';
        default:
          return `The contract rejected the transaction${name ? ` (${name})` : ''}.`;
      }
    }
    return e.shortMessage || e.message;
  }
  if (e instanceof Error) return e.message;
  return String(e);
}

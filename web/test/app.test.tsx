/**
 * App-level interaction tests with a mocked wallet and a mocked read client. Contract state is a
 * tiny in-memory model of AllowanceWallet; calldata sent by the app is decoded with the real ABI so
 * the encoding path is exercised end to end.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { decodeFunctionData, encodeEventTopics, getAddress, type Abi, type Address, type Hex } from 'viem';

const root = resolve(__dirname, '..', '..');
const handoff = JSON.parse(readFileSync(resolve(root, 'web/deployment/handoff.json'), 'utf8'));
const networkFile = JSON.parse(readFileSync(resolve(root, 'web/deployment/network.json'), 'utf8'));
const walletAbi = JSON.parse(readFileSync(resolve(root, 'docs/abi/AllowanceWallet.json'), 'utf8')) as Abi;
const tokenAbi = JSON.parse(readFileSync(resolve(root, 'docs/abi/LaunchToken.json'), 'utf8')) as Abi;

const WALLET = getAddress(handoff.contracts.find((c: { name: string }) => c.name === 'AllowanceWallet').address) as Address;
const TOKEN = getAddress(handoff.contracts.find((c: { name: string }) => c.name === 'LaunchToken').address) as Address;
const PARENT = getAddress('0x1111111111111111111111111111111111111111');
const CHILD = getAddress('0x2222222222222222222222222222222222222222');
const ONE = 10n ** 18n;

const manifest = {
  version: 1,
  launchId: handoff.launchId,
  chainId: handoff.chainId,
  sourceCommit: handoff.sourceCommit,
  attestationHash: handoff.attestationHash,
  contracts: [
    { name: 'LaunchToken', address: TOKEN, abiHash: 'a'.repeat(64), abiPath: 'abi/LaunchToken.json' },
    { name: 'AllowanceWallet', address: WALLET, abiHash: 'b'.repeat(64), abiPath: 'abi/AllowanceWallet.json' },
  ],
  assets: [{ path: 'index.html', sha256: 'c'.repeat(64) }],
  network: networkFile.network,
};

// ----- in-memory chain model ------------------------------------------------
interface Acct { parent: Address; child: Address; allowance: bigint; balance: bigint; openedAt: bigint; spent: bigint; spentWindow: bigint }
const WEEK = 604_800n;
const state = {
  chainId: 1,
  now: 1_800_000_000n,
  block: 11_800_000n,
  balances: new Map<Address, bigint>(),
  approved: new Map<string, bigint>(),
  accounts: [] as Acct[],
  logs: [] as Array<{ topics: Hex[]; args: Record<string, unknown>; eventName: string; blockNumber: bigint; logIndex: number; transactionHash: Hex }>,
  rejectNext: false,
  txCount: 0,
};
function windowOf(a: Acct) { return (state.now - a.openedAt) / WEEK; }
function spentNow(a: Acct) { return a.spentWindow === windowOf(a) ? a.spent : 0n; }
function remaining(a: Acct) { const s = spentNow(a); return a.allowance > s ? a.allowance - s : 0n; }
function emit(eventName: string, args: Record<string, unknown>, txHash: Hex) {
  const topics = encodeEventTopics({ abi: walletAbi, eventName, args } as never) as Hex[];
  state.logs.push({ topics, args, eventName, blockNumber: state.block, logIndex: state.logs.length, transactionHash: txHash });
}
function applyTx(from: Address, to: Address, data: Hex): Hex {
  state.txCount += 1;
  state.block += 1n;
  const hash = `0x${state.txCount.toString(16).padStart(64, '0')}` as Hex;
  if (to.toLowerCase() === TOKEN.toLowerCase()) {
    const { functionName, args } = decodeFunctionData({ abi: tokenAbi, data });
    if (functionName === 'approve') {
      const [spender, amount] = args as [Address, bigint];
      state.approved.set(`${from}-${spender}`.toLowerCase(), amount);
      return hash;
    }
    throw new Error(`unexpected token call ${functionName}`);
  }
  const { functionName, args } = decodeFunctionData({ abi: walletAbi, data });
  const pull = (amount: bigint) => {
    const key = `${from}-${WALLET}`.toLowerCase();
    const ok = (state.approved.get(key) ?? 0n) >= amount && (state.balances.get(from) ?? 0n) >= amount;
    if (!ok) throw new Error('execution reverted: SafeERC20FailedOperation');
    state.approved.set(key, (state.approved.get(key) ?? 0n) - amount);
    state.balances.set(from, (state.balances.get(from) ?? 0n) - amount);
  };
  switch (functionName) {
    case 'openAccount': {
      const [child, allowance, deposit] = args as [Address, bigint, bigint];
      if (deposit > 0n) pull(deposit);
      state.accounts.push({ parent: from, child, allowance, balance: deposit, openedAt: state.now, spent: 0n, spentWindow: 0n });
      emit('Opened', { id: BigInt(state.accounts.length), parent: from, child, weeklyAllowance: allowance, deposit }, hash);
      return hash;
    }
    case 'topUp': {
      const [id, amount] = args as [bigint, bigint];
      const a = state.accounts[Number(id) - 1];
      pull(amount);
      a.balance += amount;
      emit('ToppedUp', { id, amount, newBalance: a.balance }, hash);
      return hash;
    }
    case 'setAllowance': {
      const [id, n] = args as [bigint, bigint];
      state.accounts[Number(id) - 1].allowance = n;
      emit('AllowanceSet', { id, newAllowance: n }, hash);
      return hash;
    }
    case 'parentWithdraw': {
      const [id, amount] = args as [bigint, bigint];
      const a = state.accounts[Number(id) - 1];
      a.balance -= amount;
      state.balances.set(from, (state.balances.get(from) ?? 0n) + amount);
      emit('ParentWithdrew', { id, amount, newBalance: a.balance }, hash);
      return hash;
    }
    case 'childWithdraw': {
      const [id, amount] = args as [bigint, bigint];
      const a = state.accounts[Number(id) - 1];
      if (amount > remaining(a)) throw new Error('execution reverted: ExceedsAllowance');
      const w = windowOf(a);
      a.spent = spentNow(a) + amount;
      a.spentWindow = w;
      a.balance -= amount;
      state.balances.set(from, (state.balances.get(from) ?? 0n) + amount);
      emit('ChildWithdrew', { id, amount, newBalance: a.balance, window: w }, hash);
      return hash;
    }
    default:
      throw new Error(`unexpected call ${functionName}`);
  }
}

// ----- mocked read client ---------------------------------------------------
const fakeClient = {
  async getChainId() { return 11155111; },
  async getCode({ address }: { address: Address }) { return [WALLET, TOKEN].map((a) => a.toLowerCase()).includes(address.toLowerCase()) ? '0x6001' : '0x'; },
  async getBlockNumber() { return state.block; },
  async readContract({ address, functionName, args }: { address: Address; functionName: string; args?: unknown[] }) {
    if (address.toLowerCase() === TOKEN.toLowerCase()) {
      switch (functionName) {
        case 'symbol': return 'PCKT';
        case 'name': return 'Pocket';
        case 'decimals': return 18;
        case 'balanceOf': return state.balances.get(getAddress(args![0] as Address)) ?? 0n;
        case 'allowance': return state.approved.get(`${args![0]}-${args![1]}`.toLowerCase()) ?? 0n;
      }
    }
    const id = args?.[0] as bigint | undefined;
    const a = id !== undefined ? state.accounts[Number(id) - 1] : undefined;
    switch (functionName) {
      case 'token': return TOKEN;
      case 'accountCount': return BigInt(state.accounts.length);
      case 'account': return [a!.parent, a!.child, a!.allowance, a!.balance, a!.openedAt];
      case 'remainingThisWindow': return remaining(a!);
      case 'spentThisWindow': return spentNow(a!);
      case 'childWithdrawable': { const r = remaining(a!); return r < a!.balance ? r : a!.balance; }
      case 'windowEndsAt': return a!.openedAt + (windowOf(a!) + 1n) * WEEK;
      case 'currentWindow': return windowOf(a!);
    }
    throw new Error(`unexpected read ${functionName}`);
  },
  async getLogs({ event, args, fromBlock, toBlock }: { event: { name: string }; args: Record<string, unknown>; fromBlock: bigint; toBlock: bigint }) {
    return state.logs
      .filter((l) => l.eventName === event.name && l.blockNumber >= fromBlock && l.blockNumber <= toBlock)
      .filter((l) => Object.entries(args ?? {}).every(([k, v]) => {
        const want = Array.isArray(v) ? v : [v];
        return want.some((w) => String(w).toLowerCase() === String(l.args[k]).toLowerCase());
      }))
      .map((l) => ({ args: l.args, eventName: l.eventName, blockNumber: l.blockNumber, logIndex: l.logIndex, transactionHash: l.transactionHash }));
  },
  async simulateContract(req: { address: Address; abi: Abi; functionName: string; args: unknown[]; account: Address }) {
    return { request: req };
  },
  async waitForTransactionReceipt({ hash }: { hash: Hex }) {
    return { status: 'success', blockNumber: state.block, transactionHash: hash };
  },
};

vi.mock('../src/chain', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/chain')>();
  return { ...mod, createReadClient: () => fakeClient };
});

// ----- mocked EIP-1193 wallet -------------------------------------------------
type Listener = (...args: unknown[]) => void;
const listeners = new Map<string, Set<Listener>>();
const requests: Array<{ method: string; params?: unknown }> = [];
let account: Address = PARENT;
const provider = {
  async request({ method, params }: { method: string; params?: unknown }) {
    requests.push({ method, params });
    switch (method) {
      case 'eth_requestAccounts':
      case 'eth_accounts':
        return [account];
      case 'eth_chainId':
        return `0x${state.chainId.toString(16)}`;
      case 'wallet_switchEthereumChain': {
        const wanted = Number.parseInt((params as [{ chainId: string }])[0].chainId, 16);
        if (wanted !== 11155111) throw Object.assign(new Error('bad chain'), { code: 4902 });
        if (!knownChains.has(wanted)) throw Object.assign(new Error('Unrecognized chain ID'), { code: 4902 });
        state.chainId = wanted;
        listeners.get('chainChanged')?.forEach((l) => l(`0x${wanted.toString(16)}`));
        return null;
      }
      case 'wallet_addEthereumChain':
        knownChains.add(Number.parseInt((params as [{ chainId: string }])[0].chainId, 16));
        return null;
      case 'eth_sendTransaction': {
        if (state.rejectNext) {
          state.rejectNext = false;
          throw Object.assign(new Error('User rejected the request.'), { code: 4001 });
        }
        const tx = (params as [{ from: Address; to: Address; data: Hex }])[0];
        return applyTx(getAddress(tx.from), getAddress(tx.to), tx.data);
      }
      case 'eth_estimateGas':
        return '0x5208';
      default:
        throw new Error(`unexpected wallet method ${method}`);
    }
  },
  on(event: string, l: Listener) { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event)!.add(l); },
  removeListener(event: string, l: Listener) { listeners.get(event)?.delete(l); },
};
const knownChains = new Set<number>([1]);

function switchAccount(next: Address) {
  account = next;
  listeners.get('accountsChanged')?.forEach((l) => l([next]));
}

beforeEach(() => {
  state.chainId = 1;
  state.balances = new Map([[PARENT, 1_000n * ONE]]);
  state.approved = new Map();
  state.accounts = [];
  state.logs = [];
  state.rejectNext = false;
  state.now = BigInt(Math.floor(Date.now() / 1000)); // the countdown compares chain time with the wall clock
  knownChains.clear();
  knownChains.add(1);
  requests.length = 0;
  account = PARENT;
  window.ethereum = provider as never;
  vi.stubGlobal('fetch', async (input: string | URL) => {
    const url = String(input);
    const body = url.endsWith('imd-deployment.json') ? manifest : url.endsWith('AllowanceWallet.json') ? walletAbi : url.endsWith('LaunchToken.json') ? tokenAbi : null;
    if (!body) return new Response('not found', { status: 404 });
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete window.ethereum;
});

async function renderApp() {
  const { App } = await import('../src/App');
  render(<App />);
  await screen.findByRole('button', { name: /Connect Browser wallet/i }, { timeout: 5_000 });
}

describe('App', () => {
  it('shows the deployment, disables actions when disconnected and connects a wallet', async () => {
    const user = userEvent.setup();
    await renderApp();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Pocket allowance wallet');
    expect(screen.getByText(/allowance is a limit, not a promise/i)).toBeInTheDocument();
    expect(screen.getByText(/comes from swapping ETH in the launch pool/i)).toBeInTheDocument();
    expect(screen.getByText(/Not connected/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: WALLET })).toHaveAttribute('href', `${networkFile.network.explorer}/address/${WALLET}`);
    await user.click(screen.getByRole('button', { name: /Connect Browser wallet/i }));
    // Connected on chain 1: wrong-network state with a single switch control in the notice + header.
    expect(await screen.findAllByText(/Wrong network/)).toHaveLength(2); // header chip + notice title
    expect(screen.getAllByRole('button', { name: /Switch to Sepolia/ })).toHaveLength(1); // a single switch control
    expect(screen.getByRole('button', { name: 'Open account' })).toBeDisabled();
    // The unknown chain gets added with the pinned parameters, then switched to.
    await user.click(screen.getByRole('button', { name: /Switch to Sepolia/ }));
    await waitFor(() => expect(screen.queryAllByText(/Wrong network/)).toHaveLength(0));
    const add = requests.find((r) => r.method === 'wallet_addEthereumChain');
    expect((add?.params as unknown[])[0]).toEqual(networkFile.walletAddChain);
    expect(requests.filter((r) => r.method === 'wallet_switchEthereumChain')).toHaveLength(2);
    expect(await screen.findByText('1,000 PCKT')).toBeInTheDocument();
  });

  it('runs the parent flow: approve then open, top up, set allowance, withdraw; then the child withdraws within the allowance', async () => {
    const user = userEvent.setup();
    state.chainId = 11155111;
    await renderApp();
    await user.click(screen.getByRole('button', { name: /Connect Browser wallet/i }));
    await screen.findByText('1,000 PCKT');
    expect(await screen.findByText('No accounts opened yet')).toBeInTheDocument();

    // Validation happens on submit and focuses the first invalid field.
    const form = screen.getByRole('heading', { name: 'Open an account' }).closest('form')!;
    await user.click(within(form).getByRole('button', { name: 'Open account' }));
    expect(within(form).getByLabelText('Child address')).toHaveAttribute('aria-invalid', 'true');
    expect(within(form).getByLabelText('Child address')).toHaveFocus();

    await user.type(within(form).getByLabelText('Child address'), CHILD);
    await user.type(within(form).getByLabelText('Weekly allowance'), '50');
    await user.type(within(form).getByLabelText(/Opening deposit/), '100');
    // Approve step appears and the open button is gated on it.
    const approveBtn = await within(form).findByRole('button', { name: 'Approve deposit' });
    expect(within(form).getByRole('button', { name: 'Open account' })).toBeDisabled();
    await user.click(approveBtn);
    await within(form).findByText(/Confirmed in block/);
    await waitFor(() => expect(within(form).getByRole('button', { name: 'Open account' })).toBeEnabled());
    expect(await screen.findByText('100 PCKT', { selector: 'dd' })).toBeInTheDocument(); // approved amount
    await user.click(within(form).getByRole('button', { name: 'Open account' }));

    const card = await screen.findByRole('article', { name: 'Account #1' });
    expect(within(card).getByText('Balance').nextElementSibling).toHaveTextContent('100 PCKT');
    expect(within(card).getByText('Weekly allowance').nextElementSibling).toHaveTextContent('50 PCKT');
    expect(within(card).getByText('Remaining this window').nextElementSibling).toHaveTextContent('50 PCKT');
    expect(within(card).getByText('Window resets').nextElementSibling).toHaveTextContent(/in (7d 0h 0m|6d 23h)/);
    expect(screen.getByText(/Account #1 opened with 100 PCKT and a weekly allowance of 50 PCKT/)).toBeInTheDocument();

    // Top up (approve first) from the disclosure.
    await user.click(within(card).getByText('Top up', { selector: 'summary' }));
    await user.type(within(card).getByLabelText('Amount to add'), '25');
    await user.click(await within(card).findByRole('button', { name: 'Approve top-up' }));
    await waitFor(() => expect(within(card).getByRole('button', { name: 'Top up' })).toBeEnabled());
    await user.click(within(card).getByRole('button', { name: 'Top up' }));
    await waitFor(() => expect(within(card).getByText('Balance').nextElementSibling).toHaveTextContent('125 PCKT'));

    // Set allowance takes effect immediately.
    await user.click(within(card).getByText('Set allowance', { selector: 'summary' }));
    await user.type(within(card).getByLabelText('New weekly allowance'), '30');
    await user.click(within(card).getByRole('button', { name: 'Set allowance' }));
    await waitFor(() => expect(within(card).getByText('Weekly allowance').nextElementSibling).toHaveTextContent('30 PCKT'));

    // Parent withdraw: over-balance is caught before any transaction; a valid amount goes through.
    await user.click(within(card).getByText('Withdraw', { selector: 'summary' }));
    await user.type(within(card).getByLabelText(/Amount to withdraw/), '999');
    await user.click(within(card).getByRole('button', { name: 'Withdraw to my wallet' }));
    expect(within(card).getByText(/The account balance is 125 PCKT/)).toBeInTheDocument();
    await user.clear(within(card).getByLabelText(/Amount to withdraw/));
    await user.type(within(card).getByLabelText(/Amount to withdraw/), '5');
    await user.click(within(card).getByRole('button', { name: 'Withdraw to my wallet' }));
    await waitFor(() => expect(within(card).getByText('Balance').nextElementSibling).toHaveTextContent('120 PCKT'));

    // A wallet rejection is reported without a transaction.
    await user.type(within(card).getByLabelText(/Amount to withdraw/), '1');
    state.rejectNext = true;
    await user.click(within(card).getByRole('button', { name: 'Withdraw to my wallet' }));
    expect(await within(card).findByText(/Cancelled in the wallet/)).toBeInTheDocument();

    // Child persona: sees the account, withdraws within the allowance, is stopped beyond it.
    switchAccount(CHILD);
    const withdrawNow = await screen.findByText('You can withdraw now', {}, { timeout: 5_000 });
    const childCard = withdrawNow.closest('article')!;
    expect(childCard).toHaveAccessibleName('Account #1');
    await waitFor(() => expect(within(childCard).getByText('You can withdraw now').nextElementSibling).toHaveTextContent('30 PCKT'));
    expect(screen.getByText('No accounts opened yet')).toBeInTheDocument();
    await user.type(within(childCard).getByLabelText(/Amount to withdraw/), '31');
    await user.click(within(childCard).getByRole('button', { name: 'Withdraw to my wallet' }));
    expect(within(childCard).getByText(/Only 30 PCKT of the allowance is left/)).toBeInTheDocument();
    await user.clear(within(childCard).getByLabelText(/Amount to withdraw/));
    await user.type(within(childCard).getByLabelText(/Amount to withdraw/), '10');
    await user.click(within(childCard).getByRole('button', { name: 'Withdraw to my wallet' }));
    await waitFor(() => expect(within(childCard).getByText('Remaining allowance this window').nextElementSibling).toHaveTextContent('20 PCKT'));
    expect(within(childCard).getByText('Account balance').nextElementSibling).toHaveTextContent('110 PCKT');
    expect(screen.getByText(/Child withdrew 10 PCKT from account #1/)).toBeInTheDocument();
    expect(screen.getByText(/Withdraw maximum/)).toBeInTheDocument();

    // Next window: the allowance is back to 30 without rollover.
    state.now += WEEK;
    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(within(childCard).getByText('Remaining allowance this window').nextElementSibling).toHaveTextContent('30 PCKT'));
  });

  it('keeps transactions disabled when the deployment cannot be verified', async () => {
    const user = userEvent.setup();
    state.chainId = 11155111;
    const original = fakeClient.getCode;
    fakeClient.getCode = async () => '0x';
    try {
      await renderApp();
      await user.click(screen.getByRole('button', { name: /Connect Browser wallet/i }));
      expect(await screen.findByText('Deployed contracts could not be verified')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Open account' })).toBeDisabled();
    } finally {
      fakeClient.getCode = original;
    }
  });

  it('reports a missing manifest and never enables actions', async () => {
    vi.stubGlobal('fetch', async () => new Response('nope', { status: 404 }));
    const { App } = await import('../src/App');
    render(<App />);
    expect(await screen.findByText('Deployment configuration unavailable')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open account' })).not.toBeInTheDocument();
  });
});

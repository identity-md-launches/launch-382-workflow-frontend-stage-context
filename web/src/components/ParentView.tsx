import { useState, type FormEvent } from 'react';
import { flushSync } from 'react-dom';
import { isAddress, getAddress } from 'viem';
import type { AccountView } from '../chain';
import { formatAmount, formatDuration, formatTimestamp, parseAmount } from '../format';
import { AddressField, AmountField, ExplorerLink, Stat, TxStatusLine, isBusy } from './ui';
import { approveRequest, useAction, walletRequest, type ActionEnv } from './actions';

// ---------------------------------------------------------------------------
// Approve-then-pay: shared by "Open account" and "Top up"
// ---------------------------------------------------------------------------

function ApproveStep(props: { env: ActionEnv; amount: bigint | null; label: string; onDone: () => void }) {
  const { env, amount } = props;
  const approve = useAction(env);
  const approved = env.walletToken?.approved ?? 0n;
  const balance = env.walletToken?.balance ?? 0n;
  const needed = amount ?? 0n;
  const enough = needed === 0n || approved >= needed;
  const insufficientBalance = amount !== null && balance < amount;
  const busy = isBusy(approve.status);

  return (
    <div className="step">
      <div className="step-head">
        <span className={`step-badge ${enough ? 'step-done' : ''}`} aria-hidden="true">
          {enough ? '✓' : '1'}
        </span>
        <span className="step-title">
          Approve {amount !== null && amount > 0n ? `${formatAmount(amount, env.decimals)} ${env.symbol}` : env.symbol}
        </span>
      </div>
      <p className="field-hint">
        {enough
          ? needed === 0n
            ? 'No approval needed for a zero amount.'
            : `AllowanceWallet is already approved for ${formatAmount(approved, env.decimals)} ${env.symbol}.`
          : `The wallet contract pulls ${env.symbol} with transferFrom, so you approve the exact amount first. Currently approved: ${formatAmount(approved, env.decimals)} ${env.symbol}.`}
      </p>
      <button
        type="button"
        className="btn btn-secondary"
        disabled={!env.tx || enough || amount === null || busy || insufficientBalance}
        onClick={async () => {
          if (amount === null) return;
          const r = await approve.run(approveRequest(env, amount));
          if (r.phase === 'confirmed') props.onDone();
        }}
      >
        {busy ? 'Approving…' : props.label}
      </button>
      {insufficientBalance ? (
        <p className="field-error">
          Your balance is {formatAmount(balance, env.decimals)} {env.symbol}, less than this amount.
        </p>
      ) : null}
      <TxStatusLine status={approve.status} explorer={env.explorer} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Open account
// ---------------------------------------------------------------------------

export function OpenAccountForm(props: { env: ActionEnv; parent: string | null }) {
  const { env } = props;
  const [child, setChild] = useState('');
  const [allowance, setAllowance] = useState('');
  const [deposit, setDeposit] = useState('');
  const [errors, setErrors] = useState<{ child?: string; allowance?: string; deposit?: string }>({});
  const open = useAction(env);

  const depositAmount = deposit.trim() === '' ? 0n : parseAmount(deposit, env.decimals);
  const approved = env.walletToken?.approved ?? 0n;
  const needsApproval = depositAmount !== null && depositAmount > 0n && approved < depositAmount;
  const busy = isBusy(open.status);

  const validate = () => {
    const next: typeof errors = {};
    if (!isAddress(child.trim())) next.child = 'Enter the child’s wallet address (0x followed by 40 hex characters).';
    else if (props.parent && getAddress(child.trim()) === getAddress(props.parent))
      next.child = 'Use a different address from your own; you are the parent.';
    if (parseAmount(allowance, env.decimals) === null)
      next.allowance = `Enter the weekly allowance in ${env.symbol}, for example 25 or 12.5. Zero freezes the child.`;
    if (depositAmount === null) next.deposit = `Enter the opening deposit in ${env.symbol}, or leave it empty for 0.`;
    // Commit synchronously so the first invalid field can be focused right away.
    flushSync(() => setErrors(next));
    return Object.keys(next).length === 0;
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!validate()) {
      const first = document.querySelector<HTMLElement>('#open-account [aria-invalid="true"]');
      first?.focus();
      return;
    }
    const r = await open.run(
      walletRequest(env, 'openAccount', [getAddress(child.trim()), parseAmount(allowance, env.decimals)!, depositAmount!]),
    );
    if (r.phase === 'confirmed') {
      setChild('');
      setAllowance('');
      setDeposit('');
    }
  };

  return (
    <form id="open-account" className="card form-card" onSubmit={submit} noValidate>
      <h3 className="h-card">Open an account</h3>
      <p className="muted">
        You become the parent. The child can withdraw up to the weekly allowance from the balance; you can top up, change the
        allowance or take the balance back at any time.
      </p>
      <AddressField name="child" label="Child address" value={child} onChange={setChild} error={errors.child} disabled={busy} />
      <AmountField
        name="weeklyAllowance"
        label="Weekly allowance"
        value={allowance}
        onChange={setAllowance}
        symbol={env.symbol}
        hint="Most the child can withdraw in each 7-day window, counted from the moment the account opens."
        error={errors.allowance}
        disabled={busy}
      />
      <AmountField
        name="deposit"
        label="Opening deposit (optional)"
        value={deposit}
        onChange={setDeposit}
        symbol={env.symbol}
        hint={
          env.walletToken
            ? `Pulled from your wallet when the account opens. Balance: ${formatAmount(env.walletToken.balance, env.decimals)} ${env.symbol}.`
            : 'Pulled from your wallet when the account opens.'
        }
        error={errors.deposit}
        disabled={busy}
        max={env.walletToken ? { label: 'Use full balance', value: formatAmount(env.walletToken.balance, env.decimals, env.decimals) } : null}
      />
      {depositAmount !== null && depositAmount > 0n ? (
        <>
          <ApproveStep env={env} amount={depositAmount} label="Approve deposit" onDone={() => undefined} />
          <div className="step">
            <div className="step-head">
              <span className="step-badge" aria-hidden="true">
                2
              </span>
              <span className="step-title">Open the account</span>
            </div>
            <button type="submit" className="btn btn-primary" disabled={!env.tx || busy || needsApproval}>
              {busy ? 'Opening…' : 'Open account'}
            </button>
            {needsApproval ? <p className="field-hint">Approve the deposit first.</p> : null}
            <TxStatusLine status={open.status} explorer={env.explorer} />
          </div>
        </>
      ) : (
        <div className="action-footer">
          <button type="submit" className="btn btn-primary" disabled={!env.tx || busy}>
            {busy ? 'Opening…' : 'Open account'}
          </button>
          <TxStatusLine status={open.status} explorer={env.explorer} />
        </div>
      )}
    </form>
  );
}

// ---------------------------------------------------------------------------
// Parent account card
// ---------------------------------------------------------------------------

export function ParentAccountCard(props: { env: ActionEnv; account: AccountView; now: number }) {
  const { env, account: a, now } = props;
  const secondsToReset = Number(a.windowEndsAt) - now;
  const fmt = (v: bigint) => `${formatAmount(v, env.decimals)} ${env.symbol}`;
  return (
    <article className="card account-card" aria-labelledby={`p-acc-${a.id}`}>
      <header className="account-head">
        <h3 id={`p-acc-${a.id}`} className="h-card">
          Account #{a.id.toString()}
        </h3>
        <p className="muted">
          Child <ExplorerLink explorer={env.explorer} kind="address" value={a.child} /> · opened {formatTimestamp(a.openedAt)}
        </p>
      </header>
      <dl className="stats">
        <Stat label="Balance" value={fmt(a.balance)} emphasis />
        <Stat label="Weekly allowance" value={fmt(a.allowance)} />
        <Stat
          label="Remaining this window"
          value={fmt(a.remainingThisWindow)}
          sub={`${formatAmount(a.spentThisWindow, env.decimals)} ${env.symbol} withdrawn so far`}
        />
        <Stat label="Window resets" value={secondsToReset > 0 ? `in ${formatDuration(secondsToReset)}` : 'now'} sub={formatTimestamp(a.windowEndsAt)} />
      </dl>
      <div className="actions">
        <details className="action" name={`parent-action-${a.id}`}>
          <summary>Top up</summary>
          <TopUpForm env={env} account={a} />
        </details>
        <details className="action" name={`parent-action-${a.id}`}>
          <summary>Set allowance</summary>
          <SetAllowanceForm env={env} account={a} />
        </details>
        <details className="action" name={`parent-action-${a.id}`}>
          <summary>Withdraw</summary>
          <ParentWithdrawForm env={env} account={a} />
        </details>
      </div>
    </article>
  );
}

function TopUpForm(props: { env: ActionEnv; account: AccountView }) {
  const { env, account: a } = props;
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);
  const topUp = useAction(env);
  const parsed = parseAmount(amount, env.decimals);
  const approved = env.walletToken?.approved ?? 0n;
  const needsApproval = parsed !== null && parsed > 0n && approved < parsed;
  const busy = isBusy(topUp.status);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (parsed === null || parsed === 0n) {
      setError(`Enter an amount of ${env.symbol} greater than zero.`);
      return;
    }
    setError(null);
    const r = await topUp.run(walletRequest(env, 'topUp', [a.id, parsed]));
    if (r.phase === 'confirmed') setAmount('');
  };
  return (
    <form className="action-body" onSubmit={submit} noValidate>
      <AmountField
        name={`topup-${a.id}`}
        label="Amount to add"
        value={amount}
        onChange={setAmount}
        symbol={env.symbol}
        error={error}
        disabled={busy}
        hint={env.walletToken ? `Your balance: ${formatAmount(env.walletToken.balance, env.decimals)} ${env.symbol}.` : undefined}
        max={env.walletToken ? { label: 'Use full balance', value: formatAmount(env.walletToken.balance, env.decimals, env.decimals) } : null}
      />
      {parsed !== null && parsed > 0n ? <ApproveStep env={env} amount={parsed} label="Approve top-up" onDone={() => undefined} /> : null}
      <div className="step">
        <div className="step-head">
          <span className="step-badge" aria-hidden="true">
            2
          </span>
          <span className="step-title">Add to the balance</span>
        </div>
        <button type="submit" className="btn btn-primary" disabled={!env.tx || busy || needsApproval}>
          {busy ? 'Topping up…' : 'Top up'}
        </button>
        {needsApproval ? <p className="field-hint">Approve the amount first.</p> : null}
        <TxStatusLine status={topUp.status} explorer={env.explorer} />
      </div>
    </form>
  );
}

function SetAllowanceForm(props: { env: ActionEnv; account: AccountView }) {
  const { env, account: a } = props;
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);
  const set = useAction(env);
  const busy = isBusy(set.status);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const parsed = parseAmount(amount, env.decimals);
    if (parsed === null) {
      setError(`Enter the new weekly allowance in ${env.symbol}. Zero freezes the child.`);
      return;
    }
    setError(null);
    const r = await set.run(walletRequest(env, 'setAllowance', [a.id, parsed]));
    if (r.phase === 'confirmed') setAmount('');
  };
  return (
    <form className="action-body" onSubmit={submit} noValidate>
      <AmountField
        name={`allowance-${a.id}`}
        label="New weekly allowance"
        value={amount}
        onChange={setAmount}
        symbol={env.symbol}
        error={error}
        disabled={busy}
        hint={`Takes effect immediately. What the child already withdrew this window (${formatAmount(a.spentThisWindow, env.decimals)} ${env.symbol}) still counts. Zero freezes the child.`}
      />
      <button type="submit" className="btn btn-primary" disabled={!env.tx || busy}>
        {busy ? 'Saving…' : 'Set allowance'}
      </button>
      <TxStatusLine status={set.status} explorer={env.explorer} />
    </form>
  );
}

function ParentWithdrawForm(props: { env: ActionEnv; account: AccountView }) {
  const { env, account: a } = props;
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);
  const withdraw = useAction(env);
  const busy = isBusy(withdraw.status);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const parsed = parseAmount(amount, env.decimals);
    if (parsed === null || parsed === 0n) {
      setError(`Enter an amount of ${env.symbol} greater than zero.`);
      return;
    }
    if (parsed > a.balance) {
      setError(`The account balance is ${formatAmount(a.balance, env.decimals)} ${env.symbol}. Enter that or less.`);
      return;
    }
    setError(null);
    const r = await withdraw.run(walletRequest(env, 'parentWithdraw', [a.id, parsed]));
    if (r.phase === 'confirmed') setAmount('');
  };
  return (
    <form className="action-body" onSubmit={submit} noValidate>
      <AmountField
        name={`pwithdraw-${a.id}`}
        label="Amount to withdraw"
        value={amount}
        onChange={setAmount}
        symbol={env.symbol}
        error={error}
        disabled={busy}
        hint="Paid to your connected wallet. You can withdraw any part of the balance at any time, including what the child could still take this week."
        max={{ label: 'Withdraw all', value: formatAmount(a.balance, env.decimals, env.decimals) }}
      />
      <button type="submit" className="btn btn-primary" disabled={!env.tx || busy || a.balance === 0n}>
        {busy ? 'Withdrawing…' : 'Withdraw to my wallet'}
      </button>
      {a.balance === 0n ? <p className="field-hint">Nothing to withdraw: the balance is zero.</p> : null}
      <TxStatusLine status={withdraw.status} explorer={env.explorer} />
    </form>
  );
}

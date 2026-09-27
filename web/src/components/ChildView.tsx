import { useState, type FormEvent } from 'react';
import type { AccountView } from '../chain';
import { formatAmount, formatDuration, formatTimestamp, parseAmount } from '../format';
import { AmountField, ExplorerLink, Stat, TxStatusLine, isBusy } from './ui';
import { useAction, walletRequest, type ActionEnv } from './actions';

export function ChildAccountCard(props: { env: ActionEnv; account: AccountView; now: number }) {
  const { env, account: a, now } = props;
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);
  const withdraw = useAction(env);
  const busy = isBusy(withdraw.status);
  const secondsToReset = Number(a.windowEndsAt) - now;
  const fmt = (v: bigint) => `${formatAmount(v, env.decimals)} ${env.symbol}`;
  const frozen = a.allowance === 0n;
  const limitedByBalance = a.balance < a.remainingThisWindow;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const parsed = parseAmount(amount, env.decimals);
    if (parsed === null || parsed === 0n) {
      setError(`Enter an amount of ${env.symbol} greater than zero.`);
      return;
    }
    if (parsed > a.remainingThisWindow) {
      setError(`Only ${fmt(a.remainingThisWindow)} of the allowance is left this window. Enter that or less.`);
      return;
    }
    if (parsed > a.balance) {
      setError(`The account balance is ${fmt(a.balance)}. Enter that or less, or ask the parent to top up.`);
      return;
    }
    setError(null);
    const r = await withdraw.run(walletRequest(env, 'childWithdraw', [a.id, parsed]));
    if (r.phase === 'confirmed') setAmount('');
  };

  return (
    <article className="card account-card" aria-labelledby={`c-acc-${a.id}`}>
      <header className="account-head">
        <h3 id={`c-acc-${a.id}`} className="h-card">
          Account #{a.id.toString()}
        </h3>
        <p className="muted">
          Parent <ExplorerLink explorer={env.explorer} kind="address" value={a.parent} /> · opened {formatTimestamp(a.openedAt)}
        </p>
      </header>
      <dl className="stats">
        <Stat
          label="You can withdraw now"
          value={fmt(a.childWithdrawable)}
          emphasis
          sub={limitedByBalance ? 'limited by the account balance' : undefined}
        />
        <Stat
          label="Remaining allowance this window"
          value={fmt(a.remainingThisWindow)}
          sub={`${formatAmount(a.spentThisWindow, env.decimals)} of ${formatAmount(a.allowance, env.decimals)} ${env.symbol} used`}
        />
        <Stat label="Account balance" value={fmt(a.balance)} />
        <Stat label="Allowance resets" value={secondsToReset > 0 ? `in ${formatDuration(secondsToReset)}` : 'now'} sub={formatTimestamp(a.windowEndsAt)} />
      </dl>
      <p className="muted small">
        Unused allowance does not carry over. The parent can lower the allowance or withdraw the balance at any time, so the
        allowance is a limit, not a promise.
      </p>
      {frozen ? <p className="field-hint">The weekly allowance is zero, so withdrawals are paused until the parent raises it.</p> : null}
      <form className="action-body" onSubmit={submit} noValidate>
        <AmountField
          name={`cwithdraw-${a.id}`}
          label="Amount to withdraw"
          value={amount}
          onChange={setAmount}
          symbol={env.symbol}
          error={error}
          disabled={busy || frozen}
          hint="Paid to your connected wallet."
          max={{ label: 'Withdraw maximum', value: formatAmount(a.childWithdrawable, env.decimals, env.decimals) }}
        />
        <button type="submit" className="btn btn-primary" disabled={!env.tx || busy || a.childWithdrawable === 0n}>
          {busy ? 'Withdrawing…' : 'Withdraw to my wallet'}
        </button>
        <TxStatusLine status={withdraw.status} explorer={env.explorer} />
      </form>
    </article>
  );
}

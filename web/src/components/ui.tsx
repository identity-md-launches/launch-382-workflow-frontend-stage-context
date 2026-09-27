import { useId, type ReactNode } from 'react';
import type { Address, Hash } from 'viem';
import { shortAddress } from '../format';
import type { TxStatus } from '../tx';

/** Text box for a PCKT amount. Label is always visible; the placeholder is only an example. */
export function AmountField(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  symbol: string;
  hint?: ReactNode;
  error?: string | null;
  disabled?: boolean;
  name: string;
  max?: { label: string; value: string } | null;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [props.hint ? hintId : null, props.error ? errorId : null].filter(Boolean).join(' ') || undefined;
  return (
    <div className="field">
      <div className="field-head">
        <label htmlFor={id}>{props.label}</label>
        {props.max ? (
          <button
            type="button"
            className="btn btn-ghost btn-small"
            onClick={() => props.onChange(props.max!.value)}
            disabled={props.disabled}
          >
            {props.max.label}
          </button>
        ) : null}
      </div>
      <div className="input-wrap">
        <input
          id={id}
          name={props.name}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          placeholder="0.0"
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
          aria-invalid={props.error ? true : undefined}
          aria-describedby={describedBy}
          disabled={props.disabled}
        />
        <span className="input-unit" aria-hidden="true">
          {props.symbol}
        </span>
      </div>
      {props.hint ? (
        <p id={hintId} className="field-hint">
          {props.hint}
        </p>
      ) : null}
      {props.error ? (
        <p id={errorId} className="field-error">
          {props.error}
        </p>
      ) : null}
    </div>
  );
}

export function AddressField(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: ReactNode;
  error?: string | null;
  disabled?: boolean;
  name: string;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [props.hint ? hintId : null, props.error ? errorId : null].filter(Boolean).join(' ') || undefined;
  return (
    <div className="field">
      <label htmlFor={id}>{props.label}</label>
      <input
        id={id}
        name={props.name}
        type="text"
        inputMode="text"
        autoComplete="off"
        spellCheck={false}
        placeholder="0x…"
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        aria-invalid={props.error ? true : undefined}
        aria-describedby={describedBy}
        disabled={props.disabled}
        className="mono"
      />
      {props.hint ? (
        <p id={hintId} className="field-hint">
          {props.hint}
        </p>
      ) : null}
      {props.error ? (
        <p id={errorId} className="field-error">
          {props.error}
        </p>
      ) : null}
    </div>
  );
}

export function ExplorerLink(props: { explorer: string | null; kind: 'address' | 'tx'; value: Address | Hash | string; label?: string }) {
  const text = props.label ?? shortAddress(props.value);
  if (!props.explorer) return <span className="mono">{text}</span>;
  return (
    <a className="mono" href={`${props.explorer}/${props.kind}/${props.value}`} target="_blank" rel="noopener noreferrer">
      {text}
    </a>
  );
}

/** Inline transaction progress. A stable polite live region, updated in place. */
export function TxStatusLine(props: { status: TxStatus; explorer: string | null; idleText?: string }) {
  const s = props.status;
  let text: ReactNode = props.idleText ?? '';
  let tone = 'neutral';
  switch (s.phase) {
    case 'simulating':
      text = 'Checking the transaction…';
      break;
    case 'signing':
      text = 'Confirm in your wallet.';
      break;
    case 'pending':
      text = (
        <>
          Sent, waiting for confirmation. <ExplorerLink explorer={props.explorer} kind="tx" value={s.hash} label="View transaction" />
        </>
      );
      break;
    case 'confirmed':
      tone = 'success';
      text = (
        <>
          Confirmed in block {s.blockNumber.toString()}.{' '}
          <ExplorerLink explorer={props.explorer} kind="tx" value={s.hash} label="View transaction" />
        </>
      );
      break;
    case 'rejected':
      tone = 'warning';
      text = 'Cancelled in the wallet. Nothing was sent.';
      break;
    case 'failed':
      tone = 'danger';
      text = (
        <>
          {s.message}
          {s.hash ? (
            <>
              {' '}
              <ExplorerLink explorer={props.explorer} kind="tx" value={s.hash} label="View transaction" />
            </>
          ) : null}
        </>
      );
      break;
  }
  const busy = s.phase === 'simulating' || s.phase === 'signing' || s.phase === 'pending';
  return (
    <p className={`tx-status tone-${tone}`} role="status" aria-live="polite">
      {busy ? <span className="spinner" aria-hidden="true" /> : null}
      <span>{text}</span>
    </p>
  );
}

export function Notice(props: { tone: 'info' | 'warning' | 'danger' | 'success'; title?: string; children: ReactNode; role?: 'alert' | 'status' }) {
  const icon = { info: 'i', warning: '!', danger: '!', success: '✓' }[props.tone];
  return (
    <div className={`notice notice-${props.tone}`} role={props.role}>
      <span className="notice-icon" aria-hidden="true">
        {icon}
      </span>
      <div className="notice-body">
        {props.title ? <p className="notice-title">{props.title}</p> : null}
        <div>{props.children}</div>
      </div>
    </div>
  );
}

export function Stat(props: { label: string; value: ReactNode; sub?: ReactNode; emphasis?: boolean }) {
  return (
    <div className={`stat${props.emphasis ? ' stat-emphasis' : ''}`}>
      <dt>{props.label}</dt>
      <dd>
        <span className="stat-value num">{props.value}</span>
        {props.sub ? <span className="stat-sub">{props.sub}</span> : null}
      </dd>
    </div>
  );
}

export function isBusy(s: TxStatus): boolean {
  return s.phase === 'simulating' || s.phase === 'signing' || s.phase === 'pending';
}

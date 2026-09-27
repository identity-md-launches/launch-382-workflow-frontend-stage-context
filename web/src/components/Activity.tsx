import type { ActivityEvent, OpenedEvent } from '../chain';
import { formatAmount } from '../format';
import { ExplorerLink } from './ui';

interface Row {
  key: string;
  blockNumber: bigint;
  logIndex: number;
  text: string;
  txHash: `0x${string}`;
}

export function Activity(props: {
  opened: OpenedEvent[];
  activity: ActivityEvent[];
  symbol: string;
  decimals: number;
  explorer: string | null;
  limit?: number;
}) {
  const { symbol, decimals } = props;
  const fmt = (v: bigint | null) => (v === null ? '' : `${formatAmount(v, decimals)} ${symbol}`);
  const rows: Row[] = [
    ...props.opened.map((o) => ({
      key: `${o.txHash}:opened:${o.id}`,
      blockNumber: o.blockNumber,
      logIndex: -1,
      text: `Account #${o.id} opened with ${fmt(o.deposit)} and a weekly allowance of ${fmt(o.weeklyAllowance)}.`,
      txHash: o.txHash,
    })),
    ...props.activity.map((a) => {
      let text: string;
      switch (a.kind) {
        case 'ToppedUp':
          text = `Account #${a.id} topped up by ${fmt(a.amount)}; balance ${fmt(a.newBalance)}.`;
          break;
        case 'AllowanceSet':
          text = `Account #${a.id} weekly allowance set to ${fmt(a.amount)}.`;
          break;
        case 'ChildWithdrew':
          text = `Child withdrew ${fmt(a.amount)} from account #${a.id}; balance ${fmt(a.newBalance)}.`;
          break;
        case 'ParentWithdrew':
          text = `Parent withdrew ${fmt(a.amount)} from account #${a.id}; balance ${fmt(a.newBalance)}.`;
          break;
        default:
          text = `Account #${a.id}: ${a.kind}.`;
      }
      return { key: `${a.txHash}:${a.logIndex}`, blockNumber: a.blockNumber, logIndex: a.logIndex, text, txHash: a.txHash };
    }),
  ];
  rows.sort((x, y) => (x.blockNumber === y.blockNumber ? y.logIndex - x.logIndex : x.blockNumber < y.blockNumber ? 1 : -1));
  const shown = rows.slice(0, props.limit ?? 25);

  if (shown.length === 0) {
    return (
      <div className="empty">
        <p className="empty-title">No activity yet</p>
        <p className="muted">Openings, top-ups, allowance changes and withdrawals for your accounts appear here.</p>
      </div>
    );
  }
  return (
    <ol className="activity-list">
      {shown.map((r) => (
        <li key={r.key} className="activity-row">
          <span className="activity-text">{r.text}</span>
          <span className="activity-meta">
            <span className="num muted">Block {r.blockNumber.toString()}</span>
            <ExplorerLink explorer={props.explorer} kind="tx" value={r.txHash} label="View transaction" />
          </span>
        </li>
      ))}
    </ol>
  );
}

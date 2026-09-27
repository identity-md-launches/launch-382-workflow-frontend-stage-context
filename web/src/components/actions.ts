import { useCallback, useState } from 'react';
import type { WalletTokenState } from '../chain';
import { runTransaction, type TxContext, type TxRequest, type TxStatus } from '../tx';

/** What every action form needs to know about the environment it runs in. */
export interface ActionEnv {
  /** Null when transactions are disabled; `disabledReason` says why. */
  tx: TxContext | null;
  disabledReason: string | null;
  symbol: string;
  decimals: number;
  explorer: string | null;
  walletToken: WalletTokenState | null;
  /** Called after any confirmed transaction so live state is re-read. */
  onConfirmed: () => Promise<void>;
}

/** Track one transaction's status and run it. */
export function useAction(env: ActionEnv) {
  const [status, setStatus] = useState<TxStatus>({ phase: 'idle' });
  const run = useCallback(
    async (req: TxRequest): Promise<TxStatus> => {
      if (!env.tx) return { phase: 'failed', message: env.disabledReason ?? 'Transactions are disabled.' };
      const result = await runTransaction(env.tx, req, setStatus);
      if (result.phase === 'confirmed') await env.onConfirmed();
      return result;
    },
    [env],
  );
  const reset = useCallback(() => setStatus({ phase: 'idle' }), []);
  return { status, run, reset };
}

/** Build the ERC-20 approve request for AllowanceWallet as spender. */
export function approveRequest(env: ActionEnv, amount: bigint): TxRequest {
  const d = env.tx!.deployment;
  return { address: d.token.address, abi: d.token.abi, functionName: 'approve', args: [d.wallet.address, amount] };
}

export function walletRequest(env: ActionEnv, functionName: string, args: readonly unknown[]): TxRequest {
  const d = env.tx!.deployment;
  return { address: d.wallet.address, abi: d.wallet.abi, functionName, args };
}

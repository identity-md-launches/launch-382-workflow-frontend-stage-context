/**
 * One transaction, end to end: simulate against the public RPC (surfacing the revert reason
 * before the wallet is asked to sign), sign in the wallet, wait for the receipt.
 */
import {
  createWalletClient,
  custom,
  type Abi,
  type Address,
  type Hash,
  type PublicClient,
} from 'viem';
import type { Deployment } from './config';
import { describeError } from './chain';
import { isUserRejection, type Eip1193Provider } from './wallet';

export type TxStatus =
  | { phase: 'idle' }
  | { phase: 'simulating' }
  | { phase: 'signing' }
  | { phase: 'pending'; hash: Hash }
  | { phase: 'confirmed'; hash: Hash; blockNumber: bigint }
  | { phase: 'rejected' }
  | { phase: 'failed'; message: string; hash?: Hash };

export interface TxRequest {
  address: Address;
  abi: Abi;
  functionName: string;
  args: readonly unknown[];
}

export interface TxContext {
  client: PublicClient;
  provider: Eip1193Provider;
  deployment: Deployment;
  account: Address;
}

export async function runTransaction(
  ctx: TxContext,
  req: TxRequest,
  onStatus: (s: TxStatus) => void,
): Promise<TxStatus> {
  const finish = (s: TxStatus): TxStatus => {
    onStatus(s);
    return s;
  };
  let request;
  try {
    onStatus({ phase: 'simulating' });
    const sim = await ctx.client.simulateContract({
      address: req.address,
      abi: req.abi,
      functionName: req.functionName,
      args: req.args,
      account: ctx.account,
    } as Parameters<PublicClient['simulateContract']>[0]);
    request = sim.request;
  } catch (e) {
    return finish({ phase: 'failed', message: describeError(e) });
  }

  let hash: Hash;
  try {
    onStatus({ phase: 'signing' });
    const walletClient = createWalletClient({
      account: ctx.account,
      chain: ctx.deployment.chain,
      transport: custom(ctx.provider),
    });
    hash = await walletClient.writeContract(request as Parameters<typeof walletClient.writeContract>[0]);
  } catch (e) {
    if (isUserRejection(e)) return finish({ phase: 'rejected' });
    return finish({ phase: 'failed', message: describeError(e) });
  }

  try {
    onStatus({ phase: 'pending', hash });
    const receipt = await ctx.client.waitForTransactionReceipt({ hash, confirmations: 1, timeout: 180_000 });
    if (receipt.status !== 'success') {
      return finish({ phase: 'failed', message: 'The transaction was mined but reverted.', hash });
    }
    return finish({ phase: 'confirmed', hash, blockNumber: receipt.blockNumber });
  } catch (e) {
    return finish({ phase: 'failed', message: describeError(e), hash });
  }
}

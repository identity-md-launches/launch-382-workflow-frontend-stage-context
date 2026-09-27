import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { BaseError, ContractFunctionRevertedError, type Abi, type PublicClient } from 'viem';
import { blockRanges, describeError, scanOpened } from '../src/chain';
import type { Deployment } from '../src/config';

const root = resolve(__dirname, '..', '..');
const walletAbi = JSON.parse(readFileSync(resolve(root, 'docs/abi/AllowanceWallet.json'), 'utf8')) as Abi;

const deployment = {
  wallet: { address: '0xf01d2097c9479becbb0a96a10a49a47300ad9683', abi: walletAbi, abiHash: '' },
} as unknown as Deployment;

describe('blockRanges', () => {
  it('splits an inclusive range into chunks without gaps or overlap', () => {
    expect([...blockRanges(100n, 129n, 10n)]).toEqual([
      [100n, 109n],
      [110n, 119n],
      [120n, 129n],
    ]);
    expect([...blockRanges(5n, 7n, 10n)]).toEqual([[5n, 7n]]);
    expect([...blockRanges(8n, 7n, 10n)]).toEqual([]);
  });
});

describe('scanOpened', () => {
  it('queries chunk by chunk from the start block and halves a rejected range', () => {
    const calls: Array<[bigint, bigint]> = [];
    const getLogs = vi.fn(async (params: { fromBlock: bigint; toBlock: bigint }) => {
      calls.push([params.fromBlock, params.toBlock]);
      if (params.toBlock - params.fromBlock > 4n) throw new Error('query returned more than 10000 results');
      if (params.fromBlock <= 12n && 12n <= params.toBlock) {
        return [
          {
            args: { id: 1n, parent: '0xaaaa', child: '0xbbbb', weeklyAllowance: 5n, deposit: 1n },
            blockNumber: 12n,
            transactionHash: '0x01',
          },
        ];
      }
      return [];
    });
    const client = { getLogs } as unknown as PublicClient;
    return scanOpened(client, deployment, { parent: '0xaaaa' }, { fromBlock: 0n, toBlock: 19n, chunkSize: 10n }).then((events) => {
      expect(events).toHaveLength(1);
      expect(events[0].id).toBe(1n);
      expect(events[0].blockNumber).toBe(12n);
      // Two top-level chunks, each too large, each split once into halves of 5 blocks.
      expect(calls).toEqual([
        [0n, 9n],
        [0n, 4n],
        [5n, 9n],
        [10n, 19n],
        [10n, 14n],
        [15n, 19n],
      ]);
      const firstCall = getLogs.mock.calls[0][0] as unknown as { args: Record<string, string>; address: string };
      expect(firstCall.args).toEqual({ parent: '0xaaaa' });
      expect(firstCall.address).toBe(deployment.wallet.address);
    });
  });
});

describe('describeError', () => {
  it('maps custom errors from the ABI to instructions', () => {
    const revert = new ContractFunctionRevertedError({
      abi: walletAbi,
      functionName: 'childWithdraw',
      data: '0x' as `0x${string}`,
    });
    (revert as unknown as { data: unknown }).data = { errorName: 'ExceedsAllowance', args: [1n, 5n, 2n] };
    const wrapped = new BaseError('call reverted', { cause: revert });
    expect(describeError(wrapped)).toMatch(/remaining allowance this window/);
  });
  it('falls back to the short message and plain errors', () => {
    expect(describeError(new BaseError('Something short', { details: 'long details' }))).toBe('Something short');
    expect(describeError(new Error('boom'))).toBe('boom');
    expect(describeError('text')).toBe('text');
  });
});

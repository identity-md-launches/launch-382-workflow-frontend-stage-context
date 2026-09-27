import { useMemo } from 'react';
import { formatAmount } from './format';
import { useAccounts, useDeployment, useNowSeconds, useWallet } from './hooks';
import type { TxContext } from './tx';
import { Activity } from './components/Activity';
import { ChildAccountCard } from './components/ChildView';
import { Footer } from './components/Footer';
import { OpenAccountForm, ParentAccountCard } from './components/ParentView';
import { WalletControls } from './components/WalletControls';
import { ExplorerLink, Notice } from './components/ui';
import type { ActionEnv } from './components/actions';

export function App() {
  const dep = useDeployment();
  const deployment = dep.status === 'ready' ? dep.deployment : null;
  const client = dep.status === 'ready' ? dep.client : null;
  const integrity = dep.status === 'ready' ? dep.integrity : null;
  const tokenInfo = dep.status === 'ready' ? dep.token : null;
  const wallet = useWallet(deployment);
  const now = useNowSeconds();

  const symbol = tokenInfo?.symbol ?? 'PCKT';
  const decimals = tokenInfo?.decimals ?? 18;
  const networkName = deployment?.network?.name ?? 'the configured network';
  const onRightChain = wallet.address !== null && deployment !== null && wallet.chainId === deployment.chainId;

  // Reads need a connected address; transactions additionally need the right chain and a verified deployment.
  const accounts = useAccounts(client, deployment, wallet.address, deployment !== null);

  const disabledReason: string | null = !deployment
    ? 'Deployment configuration is not loaded.'
    : !wallet.address
      ? 'Connect a wallet to act on accounts.'
      : !onRightChain
        ? `Switch your wallet to ${networkName} to send transactions.`
        : integrity === null
          ? 'Checking the deployed contracts…'
          : !integrity.ok
            ? 'The deployed contracts could not be verified, so transactions are disabled.'
            : null;

  const txContext: TxContext | null =
    disabledReason === null && client && deployment && wallet.provider && wallet.address
      ? { client, provider: wallet.provider, deployment, account: wallet.address }
      : null;

  const env: ActionEnv = useMemo(
    () => ({
      tx: txContext,
      disabledReason,
      symbol,
      decimals,
      explorer: deployment?.explorer ?? null,
      walletToken: accounts.walletToken,
      onConfirmed: accounts.refresh,
    }),
    [txContext, disabledReason, symbol, decimals, deployment, accounts.walletToken, accounts.refresh],
  );

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="topbar">
        <div className="brand">
          <h1>Pocket allowance wallet</h1>
          <p className="tagline">Weekly {symbol} pocket money between a parent and a child, on {deployment?.network?.name ?? 'Sepolia'}.</p>
        </div>
        <WalletControls wallet={wallet} deployment={deployment} />
      </header>

      <main id="main" className="page" tabIndex={-1}>
        {dep.status === 'loading' ? (
          <p className="muted" role="status">
            Loading deployment configuration…
          </p>
        ) : null}
        {dep.status === 'error' ? (
          <Notice tone="danger" title="Deployment configuration unavailable" role="alert">
            <p>{dep.message}</p>
            <p>Transactions stay disabled until the page can load its configuration. Reload to try again.</p>
          </Notice>
        ) : null}
        {dep.status === 'ready' && dep.rpcError ? (
          <Notice tone="warning" title="Unable to reach the network">
            <p>{dep.rpcError}</p>
            <p>The public RPC endpoints did not answer. Reads and transactions stay disabled until they do. Reload to try again.</p>
          </Notice>
        ) : null}
        {integrity && !integrity.ok ? (
          <Notice tone="danger" title="Deployed contracts could not be verified" role="alert">
            <ul className="plain-list">
              {integrity.problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
            <p>Transactions are disabled.</p>
          </Notice>
        ) : null}
        {wallet.error ? (
          <Notice tone="warning" title="Wallet" role="alert">
            <p>{wallet.error}</p>
          </Notice>
        ) : null}
        {deployment && wallet.discovered && wallet.wallets.length === 0 && !wallet.address ? (
          <Notice tone="info" title="No browser wallet detected">
            <p>
              Install a browser wallet such as MetaMask or Rabby, then reload this page. Reads of your accounts and every
              transaction go through that wallet; this site never holds keys.
            </p>
          </Notice>
        ) : null}
        {wallet.address && deployment && !onRightChain ? (
          <Notice tone="warning" title={`Wrong network`}>
            <p>
              Your wallet is on chain {wallet.chainId ?? 'unknown'}; this app works on {networkName} (chain id {deployment.chainId}).
              Transactions are disabled until you switch. If the wallet does not know {networkName}, it will offer to add it.
            </p>
            <button type="button" className="btn btn-primary" onClick={() => void wallet.switchChain()} disabled={wallet.switching}>
              {wallet.switching ? 'Switching…' : `Switch to ${networkName}`}
            </button>
          </Notice>
        ) : null}

        <section className="section" aria-labelledby="how-heading">
          <h2 id="how-heading" className="h-section">
            How it works
          </h2>
          <ul className="how-list">
            <li>
              <strong>Get {symbol} first.</strong> {symbol} comes from swapping {deployment?.network?.nativeCurrency.symbol ?? 'Sepolia ETH'} in
              the launch pool{deployment?.network ? ' (Uniswap v4 on ' + deployment.network.name + ')' : ''}. This page has no swap; use the
              pool, then come back.
              {deployment?.network?.faucets?.length ? (
                <>
                  {' '}
                  Test ETH:{' '}
                  {deployment.network.faucets.map((f, i) => (
                    <span key={f}>
                      {i > 0 ? ', ' : ''}
                      <a href={f} target="_blank" rel="noopener noreferrer">
                        {new URL(f).hostname}
                      </a>
                    </span>
                  ))}
                  .
                </>
              ) : null}
            </li>
            <li>
              <strong>Approve, then pay.</strong> Opening with a deposit and topping up pull {symbol} from your wallet, so each one is
              an approve step followed by the action.
            </li>
            <li>
              <strong>The allowance is a limit, not a promise.</strong> The child can take up to the weekly allowance from the balance
              in each 7-day window and unused allowance never rolls over. The parent can change the allowance or withdraw the whole
              balance at any time.
            </li>
          </ul>
        </section>

        <section className="section" aria-labelledby="wallet-heading">
          <div className="section-head">
            <h2 id="wallet-heading" className="h-section">
              Your wallet
            </h2>
            {wallet.address ? (
              <button
                type="button"
                className="btn btn-secondary btn-small"
                onClick={() => void accounts.refresh()}
                disabled={accounts.status === 'scanning' || accounts.status === 'reading'}
              >
                {accounts.status === 'scanning' || accounts.status === 'reading' ? 'Refreshing…' : 'Refresh'}
              </button>
            ) : null}
          </div>
          {!wallet.address ? (
            <div className="empty">
              <p className="empty-title">Not connected</p>
              <p className="muted">Connect a wallet to see your {symbol} balance and the accounts you are part of.</p>
            </div>
          ) : (
            <dl className="kv">
              <div>
                <dt>Address</dt>
                <dd>
                  <ExplorerLink explorer={deployment?.explorer ?? null} kind="address" value={wallet.address} label={wallet.address} />
                </dd>
              </div>
              <div>
                <dt>{symbol} balance</dt>
                <dd className="num">{accounts.walletToken ? `${formatAmount(accounts.walletToken.balance, decimals)} ${symbol}` : '…'}</dd>
              </div>
              <div>
                <dt>Approved for AllowanceWallet</dt>
                <dd className="num">{accounts.walletToken ? `${formatAmount(accounts.walletToken.approved, decimals)} ${symbol}` : '…'}</dd>
              </div>
              <div>
                <dt>Data</dt>
                <dd className="muted">
                  {accounts.status === 'scanning'
                    ? `Scanning Opened events${accounts.scannedTo ? ` to block ${accounts.scannedTo}` : ''}…`
                    : accounts.status === 'reading'
                      ? 'Reading account state…'
                      : accounts.status === 'error'
                        ? `Unable to read from the network: ${accounts.error}`
                        : accounts.lastUpdated
                          ? `Live from block ${accounts.latestBlock?.toString() ?? '?'}, refreshed ${new Date(accounts.lastUpdated).toLocaleTimeString()}. Updates every 30 seconds.`
                          : 'Waiting for the network…'}
                </dd>
              </div>
            </dl>
          )}
          {disabledReason && wallet.address ? (
            <p className="muted small" role="status">
              {disabledReason}
            </p>
          ) : null}
        </section>

        <section className="section" aria-labelledby="parent-heading">
          <h2 id="parent-heading" className="h-section">
            Parent view
          </h2>
          <p className="muted">Accounts you opened, built from Opened events where you are the parent.</p>
          {wallet.address ? (
            <>
              {/* Keyed by address so per-form transaction status never carries over to another persona. */}
              <OpenAccountForm key={wallet.address} env={env} parent={wallet.address} />
              {accounts.parentAccounts.length === 0 ? (
                accounts.status === 'scanning' || accounts.status === 'reading' ? (
                  <p className="muted" role="status">
                    Looking for accounts you opened…
                  </p>
                ) : (
                  <div className="empty">
                    <p className="empty-title">No accounts opened yet</p>
                    <p className="muted">Open one above to start a weekly allowance for a child.</p>
                  </div>
                )
              ) : (
                <div className="card-grid">
                  {accounts.parentAccounts.map((a) => (
                    <ParentAccountCard key={`${wallet.address}-${a.id}`} env={env} account={a} now={now} />
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="empty">
              <p className="empty-title">Connect to open or manage accounts</p>
              <p className="muted">Once connected you can open an account, top it up, change its allowance or withdraw.</p>
            </div>
          )}
        </section>

        <section className="section" aria-labelledby="child-heading">
          <h2 id="child-heading" className="h-section">
            Child view
          </h2>
          <p className="muted">Accounts where you are the child, built from Opened events where you are the child.</p>
          {wallet.address ? (
            accounts.childAccounts.length === 0 ? (
              accounts.status === 'scanning' || accounts.status === 'reading' ? (
                <p className="muted" role="status">
                  Looking for accounts opened for you…
                </p>
              ) : (
                <div className="empty">
                  <p className="empty-title">No allowance accounts for this address</p>
                  <p className="muted">When a parent opens an account naming your address as the child, it appears here.</p>
                </div>
              )
            ) : (
              <div className="card-grid">
                {accounts.childAccounts.map((a) => (
                  <ChildAccountCard key={`${wallet.address}-${a.id}`} env={env} account={a} now={now} />
                ))}
              </div>
            )
          ) : (
            <div className="empty">
              <p className="empty-title">Connect to see your allowance</p>
              <p className="muted">Shows what you can withdraw now and when the weekly allowance resets.</p>
            </div>
          )}
        </section>

        <section className="section" aria-labelledby="activity-heading">
          <h2 id="activity-heading" className="h-section">
            Activity
          </h2>
          <p className="muted">Recent on-chain events for your accounts, read directly from the contract logs.</p>
          {wallet.address ? (
            <Activity opened={accounts.opened} activity={accounts.activity} symbol={symbol} decimals={decimals} explorer={deployment?.explorer ?? null} />
          ) : (
            <p className="muted">Connect a wallet to see activity.</p>
          )}
        </section>
      </main>
      <Footer deployment={deployment} />
    </>
  );
}

import { useState } from 'react';
import { shortAddress } from '../format';
import type { WalletState } from '../hooks';
import type { Deployment } from '../config';

export function WalletControls(props: { wallet: WalletState; deployment: Deployment | null }) {
  const { wallet, deployment } = props;
  const [pickerOpen, setPickerOpen] = useState(false);
  const wrongChain = wallet.address !== null && deployment !== null && wallet.chainId !== deployment.chainId;
  const networkName = deployment?.network?.name ?? (deployment ? `chain ${deployment.chainId}` : 'the network');

  if (wallet.address) {
    return (
      <div className="wallet-controls">
        <div className="wallet-identity">
          <span className={`chip ${wrongChain ? 'chip-warning' : 'chip-ok'}`}>
            <span className="chip-dot" aria-hidden="true" />
            {wrongChain ? `Wrong network` : networkName}
          </span>
          <span className="mono wallet-address" title={wallet.address}>
            {shortAddress(wallet.address)}
          </span>
        </div>
        <button type="button" className="btn btn-secondary" onClick={wallet.disconnect}>
          Disconnect
        </button>
      </div>
    );
  }

  if (!wallet.discovered) {
    return (
      <div className="wallet-controls">
        <span className="muted">Looking for a wallet…</span>
      </div>
    );
  }

  if (wallet.wallets.length === 0) {
    return (
      <div className="wallet-controls">
        <span className="chip chip-neutral">No wallet found</span>
      </div>
    );
  }

  if (wallet.wallets.length === 1) {
    const only = wallet.wallets[0];
    return (
      <div className="wallet-controls">
        <button type="button" className="btn btn-primary" onClick={() => void wallet.connect(only)} disabled={wallet.connecting}>
          {wallet.connecting ? 'Connecting…' : `Connect ${only.name}`}
        </button>
      </div>
    );
  }

  return (
    <div className="wallet-controls">
      <button
        type="button"
        className="btn btn-primary"
        aria-expanded={pickerOpen}
        aria-controls="wallet-picker"
        onClick={() => setPickerOpen((o) => !o)}
        disabled={wallet.connecting}
      >
        {wallet.connecting ? 'Connecting…' : 'Connect wallet'}
      </button>
      {pickerOpen ? (
        <ul id="wallet-picker" className="wallet-picker" aria-label="Available wallets">
          {wallet.wallets.map((w) => (
            <li key={w.id}>
              <button
                type="button"
                className="btn btn-secondary btn-block"
                onClick={() => {
                  setPickerOpen(false);
                  void wallet.connect(w);
                }}
              >
                {w.icon ? <img src={w.icon} alt="" width={20} height={20} /> : null}
                {w.name}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

import type { Deployment } from '../config';
import { DEPLOYMENT_CONFIG_PATH } from '../config';
import { ExplorerLink } from './ui';

export function Footer(props: { deployment: Deployment | null }) {
  const d = props.deployment;
  if (!d) return null;
  const net = d.network;
  return (
    <footer className="site-footer">
      <h2 className="h-section">Contracts and network</h2>
      <dl className="kv">
        <div>
          <dt>Network</dt>
          <dd>
            {net?.name ?? 'Unknown'} (chain id <span className="num">{d.chainId}</span>)
          </dd>
        </div>
        {d.manifest.contracts.map((c) => (
          <div key={c.name}>
            <dt>{c.name}</dt>
            <dd>
              <ExplorerLink explorer={d.explorer} kind="address" value={c.address} label={c.address} />
            </dd>
          </div>
        ))}
        {net ? (
          <div>
            <dt>Launch pool (Uniswap v4 PoolManager)</dt>
            <dd>
              <ExplorerLink explorer={d.explorer} kind="address" value={net.uniswapV4.poolManager} label={net.uniswapV4.poolManager} />
            </dd>
          </div>
        ) : null}
        <div>
          <dt>Public RPC endpoints</dt>
          <dd>
            <ul className="plain-list">
              {d.rpcUrls.map((u) => (
                <li key={u} className="mono break">
                  {u}
                </li>
              ))}
            </ul>
          </dd>
        </div>
        <div>
          <dt>Source commit</dt>
          <dd className="mono break">{d.manifest.sourceCommit}</dd>
        </div>
        <div>
          <dt>Launch id</dt>
          <dd className="mono break">{d.manifest.launchId}</dd>
        </div>
        <div>
          <dt>Runtime configuration</dt>
          <dd>
            <a href={`./${DEPLOYMENT_CONFIG_PATH}`} className="mono">
              {DEPLOYMENT_CONFIG_PATH}
            </a>
          </dd>
        </div>
      </dl>
      <p className="muted small">
        This page is a static export served without a backend. Reads go to the public RPC endpoints above; transactions are signed
        only in your wallet. Nothing here is financial advice and Sepolia assets have no monetary value.
      </p>
    </footer>
  );
}

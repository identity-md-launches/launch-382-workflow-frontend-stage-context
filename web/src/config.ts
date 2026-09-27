/**
 * Runtime deployment configuration.
 *
 * Every address, chain id, ABI and public RPC URL the app uses comes from ONE file, the
 * `imd-deployment.json` manifest that sits next to `index.html` in the static export. The
 * build step (`scripts/manifest.mjs`) writes it from the attested deployment handoff; the app
 * never carries an independent copy that could disagree with it.
 *
 * No private credentials exist anywhere in this configuration: the RPC URLs are public
 * endpoints and transaction signing stays in the visitor's wallet.
 */
import type { Abi, Address, Hex } from 'viem';
import { defineChain } from 'viem';

/** Path of the manifest, relative to the page (works from a gateway subpath or an ENS name). */
export const DEPLOYMENT_CONFIG_PATH = 'imd-deployment.json';

/** Block-range size for chunked `eth_getLogs` scans from the deployment block. */
export const LOG_CHUNK_SIZE = 10_000n;

/** Names the app expects in the manifest's contract set. */
export const CONTRACT_NAMES = {
  wallet: 'AllowanceWallet',
  token: 'LaunchToken',
} as const;

export interface ManifestContract {
  name: string;
  address: Address;
  abiHash: string;
  abiPath: string;
}

export interface ManifestAsset {
  path: string;
  sha256: string;
}

export interface NetworkBlock {
  chainId: number;
  name: string;
  testnet: boolean;
  rpcUrls: string[];
  explorer: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  faucets: string[];
  uniswapV4: {
    poolManager: Address;
    universalRouter: Address;
    quoter: Address;
    stateView: Address;
    positionManager: Address;
    permit2: Address;
  };
}

export interface DeploymentManifest {
  version: 1;
  launchId: string;
  chainId: number;
  sourceCommit: string;
  attestationHash: string;
  contracts: ManifestContract[];
  assets: ManifestAsset[];
  network?: NetworkBlock;
}

/** Everything the app needs at runtime, resolved from the manifest plus the referenced ABI files. */
export interface Deployment {
  manifest: DeploymentManifest;
  chainId: number;
  chain: ReturnType<typeof defineChain>;
  network: NetworkBlock | null;
  rpcUrls: string[];
  explorer: string | null;
  wallet: { address: Address; abi: Abi; abiHash: string };
  token: { address: Address; abi: Abi; abiHash: string };
  /** Parameters for `wallet_addEthereumChain`, derived from the network block. */
  walletAddChain: WalletAddChainParams | null;
}

export interface WalletAddChainParams {
  chainId: Hex;
  chainName: string;
  rpcUrls: string[];
  nativeCurrency: { name: string; symbol: string; decimals: number };
  blockExplorerUrls: string[];
}

export class DeploymentConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeploymentConfigError';
  }
}

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const HASH_RE = /^[0-9a-f]{64}$/;

function isSafeRelativePath(p: string): boolean {
  return (
    typeof p === 'string' &&
    p.length > 0 &&
    !p.startsWith('/') &&
    !/^[a-z]+:/i.test(p) &&
    !p.split('/').includes('..')
  );
}

/** Validate the manifest shape strictly: a malformed manifest must never enable transactions. */
export function validateManifest(raw: unknown): DeploymentManifest {
  if (!raw || typeof raw !== 'object') throw new DeploymentConfigError('Manifest is not an object.');
  const m = raw as Record<string, unknown>;
  if (m.version !== 1) throw new DeploymentConfigError('Manifest version must be 1.');
  if (typeof m.launchId !== 'string' || !m.launchId) throw new DeploymentConfigError('Manifest launchId missing.');
  if (typeof m.chainId !== 'number' || !Number.isInteger(m.chainId) || m.chainId <= 0)
    throw new DeploymentConfigError('Manifest chainId must be a positive integer.');
  if (typeof m.sourceCommit !== 'string' || !/^[0-9a-f]{40}$/.test(m.sourceCommit))
    throw new DeploymentConfigError('Manifest sourceCommit must be a 40-hex commit.');
  if (typeof m.attestationHash !== 'string' || !HASH_RE.test(m.attestationHash))
    throw new DeploymentConfigError('Manifest attestationHash must be 64 lowercase hex characters.');
  if (!Array.isArray(m.contracts) || m.contracts.length === 0)
    throw new DeploymentConfigError('Manifest contracts must be a non-empty array.');
  for (const c of m.contracts as Record<string, unknown>[]) {
    if (typeof c.name !== 'string' || !c.name) throw new DeploymentConfigError('Contract name missing.');
    if (typeof c.address !== 'string' || !ADDRESS_RE.test(c.address))
      throw new DeploymentConfigError(`Contract ${c.name} has an invalid address.`);
    if (typeof c.abiHash !== 'string' || !HASH_RE.test(c.abiHash))
      throw new DeploymentConfigError(`Contract ${c.name} has an invalid abiHash.`);
    if (typeof c.abiPath !== 'string' || !isSafeRelativePath(c.abiPath))
      throw new DeploymentConfigError(`Contract ${c.name} has an invalid abiPath.`);
  }
  if (!Array.isArray(m.assets)) throw new DeploymentConfigError('Manifest assets must be an array.');
  for (const a of m.assets as Record<string, unknown>[]) {
    if (typeof a.path !== 'string' || !isSafeRelativePath(a.path))
      throw new DeploymentConfigError('Manifest asset path invalid.');
    if (typeof a.sha256 !== 'string' || !HASH_RE.test(a.sha256))
      throw new DeploymentConfigError(`Asset ${a.path} has an invalid sha256.`);
  }
  if (m.network !== undefined) {
    const n = m.network as Record<string, unknown>;
    if (!n || typeof n !== 'object') throw new DeploymentConfigError('Manifest network must be an object.');
    if (n.chainId !== m.chainId) throw new DeploymentConfigError('Manifest network.chainId differs from chainId.');
    if (!Array.isArray(n.rpcUrls) || n.rpcUrls.length === 0 || !n.rpcUrls.every((u) => typeof u === 'string'))
      throw new DeploymentConfigError('Manifest network.rpcUrls must list public RPC URLs.');
    if (typeof n.name !== 'string' || typeof n.explorer !== 'string')
      throw new DeploymentConfigError('Manifest network needs name and explorer.');
    const nc = n.nativeCurrency as Record<string, unknown> | undefined;
    if (!nc || typeof nc.symbol !== 'string' || typeof nc.decimals !== 'number')
      throw new DeploymentConfigError('Manifest network.nativeCurrency invalid.');
  }
  return raw as DeploymentManifest;
}

function toHexChainId(id: number): Hex {
  return `0x${id.toString(16)}` as Hex;
}

export function walletAddChainFromNetwork(n: NetworkBlock): WalletAddChainParams {
  return {
    chainId: toHexChainId(n.chainId),
    chainName: n.name,
    rpcUrls: [...n.rpcUrls],
    nativeCurrency: { ...n.nativeCurrency },
    blockExplorerUrls: [n.explorer],
  };
}

function findContract(m: DeploymentManifest, name: string): ManifestContract {
  const c = m.contracts.find((x) => x.name === name);
  if (!c) throw new DeploymentConfigError(`Manifest does not declare the ${name} contract.`);
  return c;
}

/** Resolve a manifest-relative path against the page URL, so subpath hosting works. */
export function resolveAssetUrl(relativePath: string, base: string = document.baseURI): string {
  return new URL(relativePath, base).toString();
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new DeploymentConfigError(`Unable to load ${url} (HTTP ${res.status}).`);
  return res.json();
}

/**
 * Load the manifest and the ABI files it references. Throws `DeploymentConfigError` on any
 * inconsistency so the caller can keep every transaction control disabled.
 */
export async function loadDeployment(base: string = document.baseURI): Promise<Deployment> {
  const manifest = validateManifest(await fetchJson(resolveAssetUrl(DEPLOYMENT_CONFIG_PATH, base)));
  const walletEntry = findContract(manifest, CONTRACT_NAMES.wallet);
  const tokenEntry = findContract(manifest, CONTRACT_NAMES.token);

  const [walletAbi, tokenAbi] = await Promise.all([
    fetchJson(resolveAssetUrl(walletEntry.abiPath, base)),
    fetchJson(resolveAssetUrl(tokenEntry.abiPath, base)),
  ]);
  if (!Array.isArray(walletAbi) || !Array.isArray(tokenAbi))
    throw new DeploymentConfigError('An ABI file is not a JSON array.');

  const network = manifest.network ?? null;
  const rpcUrls = network?.rpcUrls ?? [];
  if (rpcUrls.length === 0)
    throw new DeploymentConfigError('No public RPC URL is configured; the manifest has no network block.');

  const nativeCurrency = network?.nativeCurrency ?? { name: 'Ether', symbol: 'ETH', decimals: 18 };
  const chain = defineChain({
    id: manifest.chainId,
    name: network?.name ?? `Chain ${manifest.chainId}`,
    nativeCurrency,
    rpcUrls: { default: { http: rpcUrls } },
    blockExplorers: network ? { default: { name: 'Explorer', url: network.explorer } } : undefined,
    testnet: network?.testnet ?? true,
  });

  return {
    manifest,
    chainId: manifest.chainId,
    chain,
    network,
    rpcUrls,
    explorer: network?.explorer ?? null,
    wallet: { address: walletEntry.address, abi: walletAbi as Abi, abiHash: walletEntry.abiHash },
    token: { address: tokenEntry.address, abi: tokenAbi as Abi, abiHash: tokenEntry.abiHash },
    walletAddChain: network ? walletAddChainFromNetwork(network) : null,
  };
}

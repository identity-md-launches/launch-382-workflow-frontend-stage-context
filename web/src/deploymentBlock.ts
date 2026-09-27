/**
 * First block to scan for `Opened` events: the block in which the attested deployment
 * transaction was mined (handoff `contracts[].blockNumber`). The manifest schema published to
 * `dist/imd-deployment.json` has no field for it, so it lives here and `scripts/manifest.mjs`
 * refuses to build when this value differs from the handoff.
 */
export const LOG_SCAN_START_BLOCK = 11791657n;

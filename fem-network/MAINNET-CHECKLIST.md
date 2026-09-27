# FEM Mainnet Handoff

## Current Agent Status

- Scope is Besu chain infrastructure only. Wallet, scan, DEX, branding, and app registration are outside this repository.
- No final genesis has been created.
- No Besu node has been initialized or started.
- No mainnet funds have been deposited.
- The current checkout is source revision `cc876cb364` with local changes, not a tagged released Besu version.
- Do not invent missing values. Stop and request them from the project owner.

## Completed

- Besu generated three QBFT validator keypairs.
- Validator private keys are owner-only (`600`); validator directories are owner-only (`700`).
- FEM chain ID is `23124`.
- QBFT block period is 2 seconds.
- Allocation plan totals 25,000,000,000 FEM across ten allocation buckets.
- All ten allocation addresses are recorded in the plan; genesis will credit each address directly.
- Initial QBFT set has three validators and requires two for quorum; it does not tolerate one Byzantine validator.

## Before Final Genesis

- Confirm every allocation address in `mainnet-allocation-plan.json` is controlled by the intended owner.
- Choose the exact released Besu version and its stable fork schedule.
- Activate London at block 0 with `zeroBaseFee=true` and genesis `baseFeePerGas=0`; this avoids burning fees while supporting legacy and EIP-1559 transactions.
- Keep the 1 Gwei minimum transaction and tx-pool gas prices identical across all validators.
- Set the final Unix timestamp once.
- Provide private IPs and P2P ports for all three validators, plus each node's two static peer enodes.
- Bind P2P to the private interface (not `0.0.0.0`) and advertise the matching private IP.
- Use SNAP sync with `sync-min-peers=1` for the three-validator network; full sync defaults to waiting for five peers.
- Configure `permissions_config.toml` on each node to allow only the other two validator enodes.
- Restrict inbound P2P TCP at the host/cloud firewall to the other two validators' private IPs; do not expose RPC ports.
- Keep HTTP RPC bound to `127.0.0.1`; use an SSH tunnel for administration if needed.
- Run `node scripts/validate-network.js` and `node scripts/verify-supply.js`.
- Resolve or explicitly document the npm `tmp` advisories before deployment.
- Prepare `final-input.json` and run the guarded finalizer.
- Review the generated file manually and compute its genesis hash from a running Besu node.

Each allocation amount is credited directly to its listed address in genesis. Allocation owners manage any later distribution; no reward contract or allowlist is required for genesis allocation.

## Deployment Order

1. Back up validator private keys offline using separate secure locations.
2. Distribute validators across independent hosts/operators.
3. Initialize every node with the exact same finalized genesis and verify the hash.
4. Start validators and verify QBFT finality and non-zero transaction fees.
5. Verify each allocation address has the expected genesis balance.
6. Publish the finalized genesis hash and allocation plan.

## Required Owner Inputs

Provide all of these before finalization:

- Final Unix timestamp
- Exact released Besu version
- Fork schedule for that release
- Validator hostnames or IP addresses
- P2P ports and RPC policy
- Static enode URLs for each node's two validator peers
- Firewall rules limiting P2P ingress to the other validators

## Security Rules

- Never commit, upload, print, or share any `key.priv` file.
- Never modify finalized genesis after any node starts.
- Never use placeholder addresses or endpoints for mainnet.
- Verify allocation address ownership and genesis balances before launch.
- Keep node permissioning and firewall ingress restricted to the three authorized validators; never expose RPC publicly.
- Before adding validators later, rehearse and coordinate a QBFT block-header validator-set update with all operators; do not rewrite genesis on a live network.
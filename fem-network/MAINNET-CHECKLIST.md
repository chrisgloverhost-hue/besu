# FEM Mainnet Handoff

## Completed

- Besu generated four QBFT validator keypairs.
- Validator private keys are owner-only (`600`); validator directories are owner-only (`700`).
- FEM chain ID is `23124`.
- QBFT block period is 2 seconds.
- Allocation plan totals 1,000,000,000 FEM.
- Reward contract tooling compiles and its Merkle hashing checks pass.

## Before Final Genesis

- Provide real treasury and FEM system multisig addresses.
- Provide the real early-user address file and generate `allowlist.json`.
- Choose the exact released Besu version and its stable fork schedule.
- Set the final Unix timestamp once.
- Provide real node hostnames/IP addresses and ports.
- Run `node scripts/validate-network.js` and `node scripts/verify-supply.js`.
- Resolve or explicitly document the npm `tmp` advisories before deployment.
- Prepare `final-input.json` and run the guarded finalizer.
- Review the generated file manually and compute its genesis hash from a running Besu node.

## Deployment Order

1. Back up validator private keys offline using separate secure locations.
2. Distribute validators across independent hosts/operators.
3. Initialize every node with the exact same finalized genesis and verify the hash.
4. Start validators and verify QBFT finality and non-zero transaction fees.
5. Deploy and verify `FEMRewardDistributor.sol`.
6. Transfer exactly 20,000,000 FEM to the reward contract.
7. Publish the Merkle root, allowlist, contract source, and genesis hash.

## Security Rules

- Never commit, upload, print, or share any `key.priv` file.
- Never modify finalized genesis after any node starts.
- Never use placeholder addresses or endpoints for mainnet.
- Contract and multisig operations require independent review before real value is deposited.
# FEM Mainnet Handoff

FEM is configured as a QBFT EVM chain with chain ID `23124`, three Besu-generated validators, and a 2-second block period.

This is a handoff, not a launch. Another agent must not finalize genesis, initialize nodes, or start a validator until the owner supplies the values listed in [MAINNET-CHECKLIST.md](MAINNET-CHECKLIST.md). Besu is responsible for chain infrastructure; the FEM app is responsible for wallet registration and user eligibility.

The working status and remaining inputs are in [mainnet-allocation-plan.json](mainnet-allocation-plan.json). All ten allocation addresses and balances are recorded there and will be credited directly in genesis. The current `genesis.json` is a validator-generation draft and is not deployable until the guarded finalizer receives a timestamp and exact fork configuration.

Validator templates disable peer discovery, require node permissioning and static peers, cap peers at the other two validators, bind P2P to a private interface, use SNAP sync with a one-peer threshold, and bind HTTP RPC to loopback. Besu otherwise binds P2P to all interfaces and FULL sync waits for five peers by default. Before launch, allow only the other validators' private IPs through each host/cloud firewall's P2P TCP rule. Never expose RPC publicly.

FEM activates London at block 0 with Besu's `zeroBaseFee` mode. The base fee is zero, so the full effective transaction fee goes to the QBFT block proposer without base-fee burning; legacy and EIP-1559 transactions are supported. `blockReward` remains zero, so no new block subsidy is minted. The minimum transaction and tx-pool gas prices are both 1 Gwei.

Wallet metadata: chain ID `23124`, native currency `FEM`, 18 decimals. The initial QBFT set has three validators and requires two for quorum; it can continue with one unavailable validator but does not tolerate one Byzantine validator. Adding validators later requires a coordinated QBFT validator-set update.

Useful commands:

```bash
node scripts/validate-network.js
node scripts/calculate-balances.js
node scripts/verify-supply.js
npm test --prefix contracts
node scripts/test-local-network.js
```

The local end-to-end rehearsal requires a built Besu distribution at `build/install/besu` (or `BESU_BIN`). It runs three validators on loopback using temporary genesis/data directories, checks planned balances and peer links, submits a test EIP-1559 transaction, verifies proposer fee credit, then removes its temporary files.

Read [MAINNET-CHECKLIST.md](MAINNET-CHECKLIST.md) before any node is started. Never expose files under `keys/*/key.priv`.
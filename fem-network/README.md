# FEM Mainnet Handoff

FEM is configured as a QBFT EVM chain with chain ID `23124`, four Besu-generated validators, and a 2-second block period.

This is a handoff, not a launch. Another agent must not finalize genesis, initialize nodes, or start a validator until the owner supplies the values listed in [MAINNET-CHECKLIST.md](MAINNET-CHECKLIST.md). Besu is responsible for chain infrastructure; the FEM app is responsible for wallet registration and user eligibility.

The working status and remaining inputs are in [mainnet-allocation-plan.json](mainnet-allocation-plan.json). The current `genesis.json` is a validator-generation draft and is not deployable until the guarded finalizer receives real addresses, a timestamp, and an exact fork configuration.

Useful commands:

```bash
node scripts/validate-network.js
node scripts/calculate-balances.js
node scripts/verify-supply.js
npm test --prefix contracts
```

Read [MAINNET-CHECKLIST.md](MAINNET-CHECKLIST.md) before any node is started. Never expose files under `keys/*/key.priv`.
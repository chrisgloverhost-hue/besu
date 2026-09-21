# Reward Contract Deployment

1. Compile with `npm run build` and record the compiler version and artifact hash.
2. Generate and verify the real allowlist with `npm run generate-allowlist -- addresses.txt allowlist.json`.
3. Review the Merkle root and verify it with `node scripts/verify-allowlist.js allowlist.json`.
4. Deploy with the treasury/system multisig as the contract admin.
5. Confirm the deployed bytecode matches the reviewed source.
6. Transfer exactly `20,000,000 FEM` to the contract.
7. Test one claim, a duplicate claim, an invalid proof, and pause behavior.
8. Publish the contract address, source, compiler version, bytecode hash, and Merkle root.
const fs = require('fs');
const path = require('path');

const inputPath = process.argv[2];
const outputPath = process.argv[3] || path.resolve(__dirname, '..', 'genesis-final.json');
if (!inputPath) throw new Error('Usage: node scripts/finalize-genesis.js final-input.json [genesis-final.json]');
const input = JSON.parse(fs.readFileSync(path.resolve(inputPath), 'utf8'));
const root = path.resolve(__dirname, '..');
const plan = JSON.parse(fs.readFileSync(path.join(root, 'mainnet-allocation-plan.json'), 'utf8'));
const genesis = JSON.parse(fs.readFileSync(path.join(root, 'genesis.json'), 'utf8'));
const placeholders = JSON.stringify(input).match(/[A-Z][A-Z0-9_]*PLACEHOLDER|SET_[A-Z0-9_]+/g);
if (placeholders) throw new Error(`Unresolved placeholders: ${placeholders.join(', ')}`);
if (!Number.isSafeInteger(input.timestamp) || input.timestamp <= 0) throw new Error('timestamp must be a positive Unix timestamp');
if (!input.forkConfig || typeof input.forkConfig !== 'object') throw new Error('forkConfig is required');
const addressPattern = /^0x[0-9a-fA-F]{40}$/;
for (const name of ['treasuryAddress', 'rewardContractAddress', 'systemAddress']) {
  if (!addressPattern.test(input[name])) throw new Error(`${name} must be a 20-byte Ethereum address`);
}
const allocationAddresses = [input.treasuryAddress, input.rewardContractAddress, input.systemAddress]
  .map((address) => address.toLowerCase());
if (new Set(allocationAddresses).size !== allocationAddresses.length) {
  throw new Error('Treasury, reward contract, and system addresses must be distinct');
}
if (fs.existsSync(outputPath)) throw new Error(`Refusing to overwrite ${outputPath}`);
const unit = 10n ** BigInt(plan.decimals);
const allocations = {};
for (const [name, allocation] of Object.entries(plan.allocations)) {
  const address = input[`${name === 'treasury' ? 'treasury' : name === 'earlyUserRewards' ? 'rewardContract' : 'system'}Address`];
  allocations[address.slice(2).toLowerCase()] = { balance: (BigInt(allocation.amountFEM) * unit).toString() };
}
const allocatedWei = Object.values(allocations).reduce((sum, allocation) => sum + BigInt(allocation.balance), 0n);
if (allocatedWei !== BigInt(plan.totalSupplyFEM) * unit) throw new Error('Genesis allocation total does not equal total supply');
genesis.config = { ...genesis.config, ...input.forkConfig };
genesis.timestamp = `0x${input.timestamp.toString(16)}`;
genesis.gasLimit = plan.genesisSettings.gasLimit;
genesis.baseFeePerGas = plan.genesisSettings.baseFeePerGas;
genesis.alloc = allocations;
fs.writeFileSync(outputPath, `${JSON.stringify(genesis, null, 2)}\n`);
console.log(`Wrote finalized genesis to ${outputPath}`);
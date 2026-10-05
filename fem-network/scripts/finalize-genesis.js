const fs = require('fs');
const path = require('path');

const inputPath = process.argv[2];
const outputPath = process.argv[3] || path.resolve(__dirname, '..', 'genesis-final.json');
if (!inputPath) throw new Error('Usage: node scripts/finalize-genesis.js final-input.json [genesis-final.json]');
const input = JSON.parse(fs.readFileSync(path.resolve(inputPath), 'utf8'));
const root = path.resolve(__dirname, '..');
const plan = JSON.parse(fs.readFileSync(path.join(root, 'mainnet-allocation-plan.json'), 'utf8'));
const genesis = JSON.parse(fs.readFileSync(path.join(root, 'genesis.json'), 'utf8'));
if (plan.genesisSettings.londonBlock !== 0
    || plan.genesisSettings.zeroBaseFee !== true
    || plan.genesisSettings.baseFeePerGas !== '0x0') {
  throw new Error('FEM fee plan must keep London at block 0 with zeroBaseFee and a zero genesis base fee');
}
if (!/^\d+$/.test(plan.genesisSettings.minimumGasPriceWei)
    || !/^\d+$/.test(plan.genesisSettings.minimumPriorityFeeWei)
    || plan.genesisSettings.minimumGasPriceWei !== plan.genesisSettings.minimumPriorityFeeWei) {
  throw new Error('FEM minimum gas price and priority fee must be matching decimal wei values');
}
if (genesis.config.chainId !== plan.chainId) throw new Error('Source genesis chain ID does not match the FEM plan');
if (genesis.config.qbft?.blockperiodseconds !== plan.blockPeriodSeconds) {
  throw new Error('Source genesis QBFT settings do not match the FEM plan');
}
const validatorAddresses = fs.readdirSync(path.join(root, 'keys'))
  .filter((name) => /^0x[0-9a-f]{40}$/.test(name))
  .map((address) => address.toLowerCase());
if (validatorAddresses.length !== plan.validatorPolicy.initialCount) {
  throw new Error('Validator key count does not match the FEM validator plan');
}
const genesisValidatorAddresses = [...genesis.extraData.toLowerCase().matchAll(/94([0-9a-f]{40})/g)]
  .map((match) => `0x${match[1]}`);
if (genesisValidatorAddresses.length !== validatorAddresses.length
    || validatorAddresses.some((address) => !genesisValidatorAddresses.includes(address))) {
  throw new Error('Source genesis validator set does not match the FEM validator keys');
}
const placeholders = JSON.stringify(input).match(/[A-Z][A-Z0-9_]*PLACEHOLDER|SET_[A-Z0-9_]+/g);
if (placeholders) throw new Error(`Unresolved placeholders: ${placeholders.join(', ')}`);
if (!Number.isSafeInteger(input.timestamp) || input.timestamp <= 0) throw new Error('timestamp must be a positive Unix timestamp');
const supportedForkFields = new Set([
  'homesteadBlock', 'daoForkBlock', 'eip150Block', 'eip158Block', 'byzantiumBlock',
  'constantinopleBlock', 'constantinopleFixBlock', 'petersburgBlock', 'istanbulBlock',
  'muirGlacierBlock', 'berlinBlock', 'londonBlock', 'arrowGlacierBlock', 'grayGlacierBlock',
  'mergeNetSplitBlock', 'shanghaiTime', 'cancunTime', 'pragueTime', 'osakaTime', 'bpo1Time',
  'bpo2Time', 'bpo3Time', 'bpo4Time', 'bpo5Time', 'amsterdamTime'
]);
const plannedForkConfig = plan.genesisSettings.forkConfig;
if (!plannedForkConfig || typeof plannedForkConfig !== 'object' || Array.isArray(plannedForkConfig)) {
  throw new Error('The FEM plan must define its fork activation config');
}
if (input.forkConfig !== undefined && JSON.stringify(input.forkConfig) !== JSON.stringify(plannedForkConfig)) {
  throw new Error('final-input forkConfig must exactly match the FEM plan');
}
const normalizedForkConfig = {};
const seenForkFields = new Set();
for (const [field, value] of Object.entries(plannedForkConfig)) {
  const normalizedField = field.toLowerCase();
  if (!supportedForkFields.has(field)) throw new Error(`Unsupported fork config field: ${field}`);
  if (seenForkFields.has(normalizedField)) throw new Error(`Duplicate fork config field: ${field}`);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${field} must be a non-negative safe integer`);
  if (field === 'londonBlock' && value !== 0) {
    throw new Error('London must activate at block 0 for FEM zero-base-fee EIP-1559 transactions');
  }
  seenForkFields.add(normalizedField);
  normalizedForkConfig[field] = value;
}
const addressPattern = /^0x[0-9a-fA-F]{40}$/;
const allocationNames = Object.keys(plan.allocations);
for (const name of allocationNames) {
  if (!addressPattern.test(plan.allocations[name].address || '')) {
    throw new Error(`plan.allocations.${name}.address must be a 20-byte Ethereum address`);
  }
}
const allocationAddresses = allocationNames.map((name) => plan.allocations[name].address)
  .map((address) => address.toLowerCase());
if (new Set(allocationAddresses).size !== allocationAddresses.length) {
  throw new Error('Every allocation address must be distinct');
}
if (fs.existsSync(outputPath)) throw new Error(`Refusing to overwrite ${outputPath}`);
const unit = 10n ** BigInt(plan.decimals);
const allocations = {};
for (const [name, allocation] of Object.entries(plan.allocations)) {
  const address = allocation.address;
  allocations[address.slice(2).toLowerCase()] = { balance: (BigInt(allocation.amountFEM) * unit).toString() };
}
const allocatedWei = Object.values(allocations).reduce((sum, allocation) => sum + BigInt(allocation.balance), 0n);
if (allocatedWei !== BigInt(plan.totalSupplyFEM) * unit) throw new Error('Genesis allocation total does not equal total supply');
genesis.config = {
  ...genesis.config,
  ...normalizedForkConfig,
  londonBlock: plan.genesisSettings.londonBlock,
  zeroBaseFee: plan.genesisSettings.zeroBaseFee
};
genesis.config.qbft.blockreward = plan.genesisSettings.blockReward;
genesis.timestamp = `0x${input.timestamp.toString(16)}`;
genesis.nonce = '0x0';
genesis.difficulty = '0x1';
genesis.mixHash = '0x63746963616c2062797a616e74696e65206661756c7420746f6c6572616e6365';
genesis.coinbase = '0x0000000000000000000000000000000000000000';
genesis.number = '0x0';
genesis.gasLimit = plan.genesisSettings.gasLimit;
genesis.baseFeePerGas = plan.genesisSettings.baseFeePerGas;
genesis.gasUsed = '0x0';
genesis.parentHash = '0x0000000000000000000000000000000000000000000000000000000000000000';
genesis.alloc = allocations;
fs.writeFileSync(outputPath, `${JSON.stringify(genesis, null, 2)}\n`);
console.log(`Wrote finalized genesis to ${outputPath}`);
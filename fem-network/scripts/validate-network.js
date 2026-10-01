const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const plan = JSON.parse(fs.readFileSync(path.join(root, 'mainnet-allocation-plan.json'), 'utf8'));
const genesis = JSON.parse(fs.readFileSync(path.join(root, 'genesis.json'), 'utf8'));
const keysRoot = path.join(root, 'keys');
const validatorAddresses = fs.readdirSync(keysRoot).filter((name) => /^0x[0-9a-f]{40}$/.test(name)).sort();
if (validatorAddresses.length !== plan.validatorPolicy.initialCount) {
  throw new Error(`Expected ${plan.validatorPolicy.initialCount} validator directories, found ${validatorAddresses.length}`);
}
if (genesis.config.chainId !== 23124) throw new Error('Unexpected chain ID');
if (genesis.config.qbft.blockperiodseconds !== 2) throw new Error('Unexpected QBFT block period');
if (typeof genesis.extraData !== 'string' || !genesis.extraData.startsWith('0x')) throw new Error('Missing QBFT extraData');
const extraData = genesis.extraData.toLowerCase();
const minimumGasPrice = plan.genesisSettings.minimumGasPriceWei;
if (!/^\d+$/.test(minimumGasPrice)) throw new Error('Plan minimumGasPriceWei must be a decimal integer');
const minimumPriorityFee = plan.genesisSettings.minimumPriorityFeeWei;
if (!/^\d+$/.test(minimumPriorityFee)) throw new Error('Plan minimumPriorityFeeWei must be a decimal integer');
for (const address of validatorAddresses) {
  if (!extraData.includes(address.slice(2))) throw new Error(`Validator missing from extraData: ${address}`);
  const directory = path.join(keysRoot, address);
  const privateKey = path.join(directory, 'key.priv');
  const publicKey = path.join(directory, 'key.pub');
  if ((fs.statSync(directory).mode & 0o077) !== 0) throw new Error(`Validator directory is group/world accessible: ${address}`);
  if ((fs.statSync(privateKey).mode & 0o077) !== 0) throw new Error(`Private key is group/world accessible: ${privateKey}`);
  if (!fs.existsSync(publicKey)) throw new Error(`Missing public key: ${publicKey}`);
}
for (let index = 1; index <= validatorAddresses.length; index += 1) {
  const configPath = path.join(root, 'node-configs', `node-${index}`, 'config.toml.template');
  const configLines = fs.readFileSync(configPath, 'utf8').split(/\r?\n/);
  const requiredSettings = [
    'discovery-enabled=false',
    'permissions-nodes-config-file-enabled=true',
    `static-nodes-file="NODE_${index}_STATIC_NODES_FILE_PATH_PLACEHOLDER"`,
    `p2p-interface="NODE_${index}_PRIVATE_BIND_IP_PLACEHOLDER"`,
    'max-peers=2',
    'sync-mode="SNAP"',
    'sync-min-peers=1',
    `min-gas-price=${minimumGasPrice}`,
    `min-priority-fee=${minimumPriorityFee}`,
    `tx-pool-min-gas-price=${minimumGasPrice}`,
    'rpc-http-host="127.0.0.1"'
  ];
  for (const setting of requiredSettings) {
    if (!configLines.includes(setting)) throw new Error(`Missing ${setting} in ${configPath}`);
  }
}
const privateKeys = [];
function scan(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) scan(entryPath);
    else if (entry.name === 'key.priv') privateKeys.push(entryPath);
  }
}
scan(root);
if (privateKeys.length !== validatorAddresses.length) {
  throw new Error(`Expected ${validatorAddresses.length} private keys under FEM network, found ${privateKeys.length}`);
}
if (JSON.stringify(genesis).toLowerCase().includes('privatekey')) throw new Error('Genesis contains a privateKey field');
console.log(`Validated ${validatorAddresses.length} validators, QBFT extraData, private-network templates, key permissions, and private-key exposure.`);
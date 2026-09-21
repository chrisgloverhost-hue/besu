const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const genesis = JSON.parse(fs.readFileSync(path.join(root, 'genesis.json'), 'utf8'));
const keysRoot = path.join(root, 'keys');
const validatorAddresses = fs.readdirSync(keysRoot).filter((name) => /^0x[0-9a-f]{40}$/.test(name)).sort();
if (validatorAddresses.length !== 4) throw new Error(`Expected 4 validator directories, found ${validatorAddresses.length}`);
if (genesis.config.chainId !== 23124) throw new Error('Unexpected chain ID');
if (genesis.config.qbft.blockperiodseconds !== 2) throw new Error('Unexpected QBFT block period');
if (typeof genesis.extraData !== 'string' || !genesis.extraData.startsWith('0x')) throw new Error('Missing QBFT extraData');
const extraData = genesis.extraData.toLowerCase();
for (const address of validatorAddresses) {
  if (!extraData.includes(address.slice(2))) throw new Error(`Validator missing from extraData: ${address}`);
  const directory = path.join(keysRoot, address);
  const privateKey = path.join(directory, 'key.priv');
  const publicKey = path.join(directory, 'key.pub');
  if ((fs.statSync(directory).mode & 0o077) !== 0) throw new Error(`Validator directory is group/world accessible: ${address}`);
  if ((fs.statSync(privateKey).mode & 0o077) !== 0) throw new Error(`Private key is group/world accessible: ${privateKey}`);
  if (!fs.existsSync(publicKey)) throw new Error(`Missing public key: ${publicKey}`);
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
if (privateKeys.length !== 4) throw new Error(`Expected exactly 4 private keys under FEM network, found ${privateKeys.length}`);
if (JSON.stringify(genesis).toLowerCase().includes('privatekey')) throw new Error('Genesis contains a privateKey field');
console.log(`Validated ${validatorAddresses.length} validators, QBFT extraData, key permissions, and private-key exposure.`);
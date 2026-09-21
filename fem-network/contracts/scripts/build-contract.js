const fs = require('fs');
const path = require('path');
const solc = require('solc');

const contractPath = path.resolve(__dirname, '..', 'FEMRewardDistributor.sol');
const source = fs.readFileSync(contractPath, 'utf8');
const input = {
  language: 'Solidity',
  sources: { 'FEMRewardDistributor.sol': { content: source } },
  settings: { outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } }
};

const output = JSON.parse(solc.compile(JSON.stringify(input)));
const errors = (output.errors || []).filter((error) => error.severity === 'error');
if (errors.length > 0) {
  console.error(errors.map((error) => error.formattedMessage).join('\n'));
  process.exit(1);
}

const contract = output.contracts['FEMRewardDistributor.sol'].FEMRewardDistributor;
const artifact = {
  contractName: 'FEMRewardDistributor',
  compiler: `solc-${solc.version()}`,
  abi: contract.abi,
  bytecode: `0x${contract.evm.bytecode.object}`
};
const artifactPath = path.resolve(__dirname, '..', 'artifacts', 'FEMRewardDistributor.json');
fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
fs.writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);
console.log(`Compiled FEMRewardDistributor with ${artifact.bytecode.length / 2 - 1} bytes of bytecode.`);
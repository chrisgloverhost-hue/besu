const fs = require('fs');
const path = require('path');
const { solidityPackedKeccak256, keccak256, concat } = require('ethers');
const { execFileSync } = require('child_process');

execFileSync(process.execPath, [path.resolve(__dirname, 'build-contract.js')], { stdio: 'inherit' });
const source = fs.readFileSync(path.resolve(__dirname, '..', 'FEMRewardDistributor.sol'), 'utf8');
if (!source.includes('uint256 public constant REWARD = 40 ether;')) throw new Error('reward changed');
if (!source.includes('uint256 public constant MAX_CLAIMS = 500_000;')) throw new Error('claim cap changed');

const addresses = [
  '0x0000000000000000000000000000000000000001',
  '0x0000000000000000000000000000000000000002',
  '0x0000000000000000000000000000000000000003'
];
const leaves = addresses.map((address, index) => solidityPackedKeccak256(['uint256', 'address'], [index, address]));
const sibling = leaves[1];
const root = leaves[0].toLowerCase() < sibling.toLowerCase()
  ? keccak256(concat([leaves[0], sibling]))
  : keccak256(concat([sibling, leaves[0]]));
const recomputed = leaves[0].toLowerCase() < sibling.toLowerCase()
  ? keccak256(concat([leaves[0], sibling]))
  : keccak256(concat([sibling, leaves[0]]));
if (root !== recomputed) throw new Error('Merkle proof mismatch');
console.log('Contract source and Merkle leaf/proof hashing checks passed.');
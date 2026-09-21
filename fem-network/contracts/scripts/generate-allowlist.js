const fs = require('fs');
const path = require('path');
const { getAddress, solidityPackedKeccak256, keccak256, concat, zeroPadValue } = require('ethers');

const inputPath = process.argv[2];
const outputPath = process.argv[3] || path.resolve(__dirname, '..', 'allowlist.json');
if (!inputPath) {
  console.error('Usage: npm run generate-allowlist -- <addresses.txt> [allowlist.json]');
  process.exit(1);
}

const addresses = fs.readFileSync(path.resolve(inputPath), 'utf8')
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean)
  .map(getAddress);
if (addresses.length === 0 || addresses.length > 500000) {
  throw new Error('The allowlist must contain between 1 and 500000 addresses.');
}
if (new Set(addresses.map((address) => address.toLowerCase())).size !== addresses.length) {
  throw new Error('The allowlist contains duplicate addresses.');
}

const leaves = addresses.map((address, index) =>
  solidityPackedKeccak256(['uint256', 'address'], [index, address]));
const levels = [leaves];
while (levels[levels.length - 1].length > 1) {
  const current = levels[levels.length - 1];
  const next = [];
  for (let i = 0; i < current.length; i += 2) {
    const left = current[i];
    const right = current[i + 1] || left;
    next.push(left.toLowerCase() < right.toLowerCase()
      ? keccak256(concat([left, right]))
      : keccak256(concat([right, left])));
  }
  levels.push(next);
}

function proofFor(index) {
  const proof = [];
  for (let level = 0; level < levels.length - 1; level++) {
    const current = levels[level];
    const sibling = index ^ 1;
    proof.push(current[sibling] || current[index]);
    index = Math.floor(index / 2);
  }
  return proof;
}

const result = {
  merkleRoot: levels[levels.length - 1][0],
  rewardFEM: '40',
  maximumClaims: 500000,
  entries: addresses.map((address, index) => ({
    index,
    address,
    proof: proofFor(index)
  }))
};
fs.writeFileSync(path.resolve(outputPath), `${JSON.stringify(result, null, 2)}\n`);
console.log(`Generated ${addresses.length} allowlist entries.`);
console.log(`Merkle root: ${result.merkleRoot}`);
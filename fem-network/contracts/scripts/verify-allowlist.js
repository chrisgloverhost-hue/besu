const fs = require('fs');
const path = require('path');
const { solidityPackedKeccak256, keccak256, concat, getAddress } = require('ethers');

const inputPath = process.argv[2] || path.resolve(__dirname, '..', 'allowlist.json');
const list = JSON.parse(fs.readFileSync(path.resolve(inputPath), 'utf8'));
if (list.entries.length > 500000) throw new Error('Allowlist exceeds 500000 entries');
for (const entry of list.entries) {
  let hash = solidityPackedKeccak256(['uint256', 'address'], [entry.index, getAddress(entry.address)]);
  for (const sibling of entry.proof) {
    hash = hash.toLowerCase() < sibling.toLowerCase()
      ? keccak256(concat([hash, sibling]))
      : keccak256(concat([sibling, hash]));
  }
  if (hash.toLowerCase() !== list.merkleRoot.toLowerCase()) throw new Error(`Invalid proof at index ${entry.index}`);
}
console.log(`Verified ${list.entries.length} allowlist proofs against ${list.merkleRoot}.`);
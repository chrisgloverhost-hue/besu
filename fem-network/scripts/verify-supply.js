const fs = require('fs');
const path = require('path');

const plan = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'mainnet-allocation-plan.json'), 'utf8'));
const total = Object.values(plan.allocations).reduce((sum, allocation) => sum + BigInt(allocation.amountFEM), 0n);
const expected = BigInt(plan.totalSupplyFEM);
if (total !== expected) throw new Error(`Supply mismatch: ${total} != ${expected}`);
console.log(`Supply verified: ${total} FEM across ${Object.keys(plan.allocations).length} allocations.`);
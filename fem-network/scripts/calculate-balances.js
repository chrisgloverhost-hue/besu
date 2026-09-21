const fs = require('fs');
const path = require('path');

const plan = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'mainnet-allocation-plan.json'), 'utf8'));
const unit = 10n ** BigInt(plan.decimals);
const result = {};
for (const [name, allocation] of Object.entries(plan.allocations)) {
  result[name] = {
    address: allocation.address,
    amountFEM: allocation.amountFEM,
    balanceWei: (BigInt(allocation.amountFEM) * unit).toString()
  };
}
console.log(JSON.stringify({ decimals: plan.decimals, allocations: result }, null, 2));
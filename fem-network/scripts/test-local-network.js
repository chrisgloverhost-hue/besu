const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { ContractFactory, Wallet, computeAddress, parseEther } = require('../contracts/node_modules/ethers');
const solc = require('../contracts/node_modules/solc');

const femRoot = path.resolve(__dirname, '..');
const repositoryRoot = path.resolve(femRoot, '..');
const plan = JSON.parse(fs.readFileSync(path.join(femRoot, 'mainnet-allocation-plan.json'), 'utf8'));
const besu = process.env.BESU_BIN || path.join(repositoryRoot, 'build', 'install', 'besu', 'bin', 'besu');
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fem-local-e2e-'));
const children = [];
let completed = false;

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function rpc(port, method, params = []) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params });
    const request = http.request({
      hostname: '127.0.0.1',
      port,
      path: '/',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (response) => {
      let responseBody = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { responseBody += chunk; });
      response.on('end', () => {
        try {
          const result = JSON.parse(responseBody);
          if (result.error) reject(new Error(`${method}: ${result.error.message}`));
          else resolve(result.result);
        } catch (error) {
          reject(error);
        }
      });
    });
    request.setTimeout(5000, () => request.destroy(new Error(`${method} timed out`)));
    request.once('error', reject);
    request.end(body);
  });
}

async function waitFor(check, description, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const result = await check();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${description}${lastError ? `: ${lastError.message}` : ''}`);
}

async function getUniquePorts(count) {
  const ports = new Set();
  while (ports.size < count) ports.add(await getFreePort());
  return [...ports];
}

function compileLocalCryptoFixtures() {
  const source = fs.readFileSync(path.join(femRoot, 'contracts', 'test', 'LocalCryptoFlowFixtures.sol'), 'utf8');
  const output = JSON.parse(solc.compile(JSON.stringify({
    language: 'Solidity',
    sources: { 'LocalCryptoFlowFixtures.sol': { content: source } },
    settings: {
      evmVersion: 'shanghai',
      outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } }
    }
  })));
  const errors = (output.errors || []).filter((error) => error.severity === 'error');
  if (errors.length > 0) throw new Error(errors.map((error) => error.formattedMessage).join('\n'));
  return output.contracts['LocalCryptoFlowFixtures.sol'];
}

function stopNodes() {
  for (const child of children) {
    if (child.exitCode === null && child.pid) {
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
    }
  }
}

async function waitForNodesToStop() {
  await Promise.race([
    Promise.all(children.map((child) => child.exitCode !== null
      ? Promise.resolve()
      : new Promise((resolve) => child.once('close', resolve)))),
    new Promise((resolve) => setTimeout(resolve, 3000))
  ]);
  for (const child of children) {
    if (child.exitCode === null && child.pid) {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
    }
  }
}

async function main() {
  if (!fs.existsSync(besu)) throw new Error(`Besu executable not found: ${besu}`);
  const validatorDirectories = fs.readdirSync(path.join(femRoot, 'keys'))
    .filter((name) => /^0x[0-9a-f]{40}$/.test(name))
    .sort();
  if (validatorDirectories.length !== plan.validatorPolicy.initialCount) {
    throw new Error(`Expected ${plan.validatorPolicy.initialCount} validators, found ${validatorDirectories.length}`);
  }
  const contractBuild = spawnSync(process.execPath, [
    path.join(femRoot, 'contracts', 'scripts', 'build-contract.js')
  ], { encoding: 'utf8' });
  if (contractBuild.status !== 0) throw new Error(contractBuild.stderr || contractBuild.stdout);
  const contractArtifact = JSON.parse(fs.readFileSync(
    path.join(femRoot, 'contracts', 'artifacts', 'FEMRewardDistributor.json'), 'utf8'
  ));
  const localFixtures = compileLocalCryptoFixtures();

  const ports = await getUniquePorts(validatorDirectories.length * 2);
  const validators = validatorDirectories.map((address, index) => ({
    address,
    privateKeyPath: path.join(femRoot, 'keys', address, 'key.priv'),
    publicKey: fs.readFileSync(path.join(femRoot, 'keys', address, 'key.pub'), 'utf8').trim().slice(2),
    p2pPort: ports[index * 2],
    rpcPort: ports[index * 2 + 1],
    index
  }));
  const temporaryWallet = Wallet.createRandom();
  const finalizerInputPath = path.join(temporaryRoot, 'final-input.json');
  const genesisPath = path.join(temporaryRoot, 'genesis.json');
  fs.writeFileSync(finalizerInputPath, JSON.stringify({
    timestamp: Math.floor(Date.now() / 1000) - 30
  }));
  const finalizer = spawnSync(process.execPath, [
    path.join(femRoot, 'scripts', 'finalize-genesis.js'),
    finalizerInputPath,
    genesisPath
  ], { encoding: 'utf8' });
  if (finalizer.status !== 0) throw new Error(finalizer.stderr || finalizer.stdout);

  const genesis = JSON.parse(fs.readFileSync(genesisPath, 'utf8'));
  genesis.alloc[temporaryWallet.address.slice(2).toLowerCase()] = { balance: parseEther('100').toString() };
  fs.writeFileSync(genesisPath, `${JSON.stringify(genesis, null, 2)}\n`);

  for (const validator of validators) {
    const enodes = validators
      .filter((peer) => peer.index !== validator.index)
      .map((peer) => `enode://${peer.publicKey}@127.0.0.1:${peer.p2pPort}`);
    const nodeDirectory = path.join(temporaryRoot, `node-${validator.index + 1}`);
    fs.mkdirSync(nodeDirectory, { recursive: true });
    const staticNodesPath = path.join(nodeDirectory, 'static-nodes.json');
    const permissioningPath = path.join(nodeDirectory, 'permissions_config.toml');
    fs.writeFileSync(staticNodesPath, `${JSON.stringify(enodes, null, 2)}\n`);
    fs.writeFileSync(permissioningPath, `nodes-allowlist=${JSON.stringify(enodes)}\n`);

    const logPath = path.join(nodeDirectory, 'besu.log');
    const logFd = fs.openSync(logPath, 'a');
    const child = spawn(besu, [
      `--data-path=${path.join(nodeDirectory, 'data')}`,
      `--genesis-file=${genesisPath}`,
      `--node-private-key-file=${validator.privateKeyPath}`,
      '--p2p-host=127.0.0.1',
      '--p2p-interface=127.0.0.1',
      `--p2p-port=${validator.p2pPort}`,
      '--discovery-enabled=false',
      `--static-nodes-file=${staticNodesPath}`,
      '--permissions-nodes-config-file-enabled=true',
      `--permissions-nodes-config-file=${permissioningPath}`,
      '--max-peers=2',
      '--sync-mode=SNAP',
      '--sync-min-peers=1',
      `--min-gas-price=${plan.genesisSettings.minimumGasPriceWei}`,
      `--min-priority-fee=${plan.genesisSettings.minimumPriorityFeeWei}`,
      `--tx-pool-min-gas-price=${plan.genesisSettings.minimumGasPriceWei}`,
      '--rpc-http-enabled=true',
      '--rpc-http-host=127.0.0.1',
      `--rpc-http-port=${validator.rpcPort}`,
      '--rpc-http-api=ETH,NET,WEB3,ADMIN',
      '--logging=INFO'
    ], { detached: true, stdio: ['ignore', logFd, logFd] });
    fs.closeSync(logFd);
    children.push(child);
  }

  await waitFor(async () => {
    for (const validator of validators) {
      if (children[validator.index].exitCode !== null) {
        const log = fs.readFileSync(path.join(temporaryRoot, `node-${validator.index + 1}`, 'besu.log'), 'utf8');
        throw new Error(`Node ${validator.index + 1} exited: ${log.slice(-4000)}`);
      }
      const peers = await rpc(validator.rpcPort, 'admin_peers');
      const blockNumber = await rpc(validator.rpcPort, 'eth_blockNumber');
      if (peers.length < 2 || BigInt(blockNumber) < 2n) return false;
    }
    return true;
  }, 'all three validators to peer and finalize blocks');
  console.log('Three localhost validators peered and finalized blocks.');

  for (const allocation of Object.values(plan.allocations)) {
    const balance = await rpc(validators[0].rpcPort, 'eth_getBalance', [allocation.address, '0x0']);
    const expected = BigInt(allocation.amountFEM) * 10n ** BigInt(plan.decimals);
    if (BigInt(balance) !== expected) throw new Error(`Genesis allocation mismatch at ${allocation.address}`);
  }
  console.log('All ten FEM genesis allocation balances match the allocation plan.');

  const minimumPriorityFee = BigInt(plan.genesisSettings.minimumPriorityFeeWei);
  const rpcPort = validators[0].rpcPort;
  let transactionNonce = 0;

  async function submitAndCheckFee({ to, data, value = 0n, gasLimit, label, expectedStatus = 1 }) {
    const signedTransaction = await temporaryWallet.signTransaction({
      type: 2,
      chainId: plan.chainId,
      nonce: transactionNonce++,
      maxPriorityFeePerGas: minimumPriorityFee,
      maxFeePerGas: minimumPriorityFee * 2n,
      gasLimit,
      to,
      data,
      value
    });
    const transactionHash = await rpc(rpcPort, 'eth_sendRawTransaction', [signedTransaction]);
    const receipt = await waitFor(async () => {
      const result = await rpc(rpcPort, 'eth_getTransactionReceipt', [transactionHash]);
      return result || false;
    }, `${label} receipt`);
    if (BigInt(receipt.status) !== BigInt(expectedStatus)) {
      throw new Error(`${label}: expected receipt status ${expectedStatus}, got ${receipt.status}`);
    }
    const block = await rpc(rpcPort, 'eth_getBlockByHash', [receipt.blockHash, false]);
    if (BigInt(block.baseFeePerGas) !== 0n) throw new Error(`${label}: expected zero base fee, got ${block.baseFeePerGas}`);
    const proposer = block.miner.toLowerCase();
    const proposerValidator = validators.find((validator) => computeAddress(
      fs.readFileSync(validator.privateKeyPath, 'utf8').trim()
    ).toLowerCase() === proposer);
    if (!proposerValidator) throw new Error(`${label}: proposer is not one of the FEM validators: ${proposer}`);
    const gasUsed = BigInt(receipt.gasUsed);
    const effectiveGasPrice = BigInt(receipt.effectiveGasPrice);
    if (effectiveGasPrice !== minimumPriorityFee) {
      throw new Error(`${label}: expected ${minimumPriorityFee} wei effective gas price, got ${effectiveGasPrice}`);
    }
    const blockNumber = BigInt(receipt.blockNumber);
    const beforeBalance = await rpc(rpcPort, 'eth_getBalance', [proposer, `0x${(blockNumber - 1n).toString(16)}`]);
    const afterBalance = await rpc(rpcPort, 'eth_getBalance', [proposer, receipt.blockNumber]);
    const expectedCredit = gasUsed * effectiveGasPrice;
    if (BigInt(afterBalance) - BigInt(beforeBalance) !== expectedCredit) {
      throw new Error(`${label}: proposer fee credit mismatch for ${gasUsed} gas`);
    }
    console.log(`${label}: ${gasUsed} gas × ${effectiveGasPrice} wei; proposer received ${expectedCredit} wei.`);
    return receipt;
  }

  await submitAndCheckFee({
    to: temporaryWallet.address,
    gasLimit: 21000n,
    label: 'Simple transfer'
  });

  const contractFactory = new ContractFactory(contractArtifact.abi, contractArtifact.bytecode, temporaryWallet);
  const deployment = await contractFactory.getDeployTransaction(
    temporaryWallet.address,
    `0x${'00'.repeat(32)}`
  );
  const deploymentReceipt = await submitAndCheckFee({
    gasLimit: 5000000n,
    data: deployment.data,
    label: 'FEM reward contract deployment'
  });
  if (!deploymentReceipt.contractAddress) throw new Error('Reward contract deployment did not return a contract address');
  const deployedCode = await rpc(rpcPort, 'eth_getCode', [deploymentReceipt.contractAddress, 'latest']);
  if (deployedCode === '0x') throw new Error('Reward contract deployment produced no runtime bytecode');

  const contractCallData = contractFactory.interface.encodeFunctionData('setPaused', [true]);
  await submitAndCheckFee({
    to: deploymentReceipt.contractAddress,
    gasLimit: 100000n,
    data: contractCallData,
    label: 'FEM reward contract call'
  });

  async function deployFixture(name, args = []) {
    const artifact = localFixtures[name];
    const factory = new ContractFactory(artifact.abi, `0x${artifact.evm.bytecode.object}`, temporaryWallet);
    const deployment = await factory.getDeployTransaction(...args);
    const receipt = await submitAndCheckFee({
      data: deployment.data,
      gasLimit: 5000000n,
      label: `${name} deployment`
    });
    if (!receipt.contractAddress) throw new Error(`${name} deployment did not return an address`);
    const code = await rpc(rpcPort, 'eth_getCode', [receipt.contractAddress, 'latest']);
    if (code === '0x') throw new Error(`${name} deployment produced no runtime code`);
    return { address: receipt.contractAddress, factory };
  }

  async function fixtureRead(contract, method, args = []) {
    const data = contract.factory.interface.encodeFunctionData(method, args);
    const result = await rpc(rpcPort, 'eth_call', [{ to: contract.address, data }, 'latest']);
    return contract.factory.interface.decodeFunctionResult(method, result)[0];
  }

  async function fixtureWrite(contract, method, args, label, {
    value = 0n,
    gasLimit = 500000n,
    expectedStatus = 1
  } = {}) {
    const data = contract.factory.interface.encodeFunctionData(method, args);
    return submitAndCheckFee({ to: contract.address, data, value, gasLimit, label, expectedStatus });
  }

  const initialSubtokenSupply = parseEther('1000000');
  const femDollar = await deployFixture('LocalTestToken', ['Test FEM Dollar', 'tFUSD', initialSubtokenSupply]);
  const femGovernance = await deployFixture('LocalTestToken', ['Test FEM Governance', 'tFGOV', initialSubtokenSupply]);
  const wrappedFem = await deployFixture('LocalTestWrappedFEM');
  const swap = await deployFixture('LocalTestConstantProductSwap');

  const testRecipient = Wallet.createRandom().address;
  const subtokenTransfer = parseEther('25');
  await fixtureWrite(femDollar, 'transfer', [testRecipient, subtokenTransfer], 'Sub-token transfer');
  if (await fixtureRead(femDollar, 'balanceOf', [testRecipient]) !== subtokenTransfer) {
    throw new Error('Sub-token transfer balance mismatch');
  }
  if (await fixtureRead(femDollar, 'symbol') !== 'tFUSD') throw new Error('Sub-token metadata mismatch');

  const wrappedDeposit = parseEther('1');
  await fixtureWrite(wrappedFem, 'deposit', [], 'wFEM wrap', { value: wrappedDeposit });
  const receiveDeposit = parseEther('0.25');
  await submitAndCheckFee({
    to: wrappedFem.address,
    value: receiveDeposit,
    gasLimit: 100000n,
    label: 'wFEM receive-function wrap'
  });
  const wrappedBalanceBeforeWithdrawal = wrappedDeposit + receiveDeposit;
  if (await fixtureRead(wrappedFem, 'balanceOf', [temporaryWallet.address]) !== wrappedBalanceBeforeWithdrawal) {
    throw new Error('wFEM wrapped balance mismatch after receive-function deposit');
  }
  const wrappedWithdrawal = parseEther('0.4');
  await fixtureWrite(wrappedFem, 'withdraw', [wrappedWithdrawal], 'wFEM unwrap');
  const wrappedBalanceAfterWithdrawal = wrappedBalanceBeforeWithdrawal - wrappedWithdrawal;
  if (await fixtureRead(wrappedFem, 'balanceOf', [temporaryWallet.address]) !== wrappedBalanceAfterWithdrawal) {
    throw new Error('wFEM unwrap balance mismatch');
  }
  if (await fixtureRead(wrappedFem, 'totalSupply') !== wrappedBalanceAfterWithdrawal) {
    throw new Error('wFEM supply mismatch after unwrap');
  }
  if (BigInt(await rpc(rpcPort, 'eth_getBalance', [wrappedFem.address, 'latest'])) !== wrappedBalanceAfterWithdrawal) {
    throw new Error('wFEM native backing does not match its outstanding supply');
  }
  await fixtureWrite(wrappedFem, 'withdraw', [wrappedBalanceAfterWithdrawal + 1n], 'Reject over-withdrawal', {
    expectedStatus: 0
  });
  if (await fixtureRead(wrappedFem, 'balanceOf', [temporaryWallet.address]) !== wrappedBalanceAfterWithdrawal) {
    throw new Error('Failed wFEM withdrawal changed the token balance');
  }

  const liquidity = parseEther('10000');
  await fixtureWrite(femDollar, 'transfer', [swap.address, liquidity], 'Seed test swap token A');
  await fixtureWrite(femGovernance, 'transfer', [swap.address, liquidity], 'Seed test swap token B');
  const swapInput = parseEther('100');
  const minimumSwapOutput = parseEther('98');
  await fixtureWrite(femDollar, 'approve', [swap.address, swapInput], 'Approve test swap');
  const tokenOutBefore = await fixtureRead(femGovernance, 'balanceOf', [temporaryWallet.address]);
  const inputBalanceBeforeSwap = await fixtureRead(femDollar, 'balanceOf', [temporaryWallet.address]);
  await fixtureWrite(swap, 'swapExactInput', [
    femDollar.address,
    femGovernance.address,
    swapInput,
    parseEther('99'),
    temporaryWallet.address
  ], 'Reject swap above available slippage output', { expectedStatus: 0 });
  if (await fixtureRead(femDollar, 'balanceOf', [temporaryWallet.address]) !== inputBalanceBeforeSwap
      || await fixtureRead(femDollar, 'allowance', [temporaryWallet.address, swap.address]) !== swapInput
      || await fixtureRead(femGovernance, 'balanceOf', [temporaryWallet.address]) !== tokenOutBefore) {
    throw new Error('Reverted slippage-protected swap changed balances or allowance');
  }
  await fixtureWrite(swap, 'swapExactInput', [
    femDollar.address,
    femGovernance.address,
    swapInput,
    minimumSwapOutput,
    temporaryWallet.address
  ], 'Test token swap');
  const tokenOutAfter = await fixtureRead(femGovernance, 'balanceOf', [temporaryWallet.address]);
  if (tokenOutAfter - tokenOutBefore < minimumSwapOutput) throw new Error('Swap output is below the minimum slippage amount');
  if (await fixtureRead(femDollar, 'allowance', [temporaryWallet.address, swap.address]) !== 0n) {
    throw new Error('Swap did not consume the approved token allowance');
  }
  console.log('Test ERC-20 transfer/approval, wFEM wrap/unwrap, and constant-product swap passed.');
  completed = true;
}

main()
  .catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    stopNodes();
    await waitForNodesToStop();
    if (completed) fs.rmSync(temporaryRoot, { recursive: true, force: true });
    else console.error(`Retained local E2E diagnostics at ${temporaryRoot}`);
  });
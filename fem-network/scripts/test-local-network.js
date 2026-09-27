const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { Wallet, computeAddress, parseEther } = require('../contracts/node_modules/ethers');

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
    timestamp: Math.floor(Date.now() / 1000) - 30,
    forkConfig: {
      homesteadBlock: 0,
      istanbulBlock: 0,
      berlinBlock: 0,
      londonBlock: 0
    }
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

  const signedTransaction = await temporaryWallet.signTransaction({
    type: 2,
    chainId: plan.chainId,
    nonce: 0,
    maxPriorityFeePerGas: 1000000000n,
    maxFeePerGas: 2000000000n,
    gasLimit: 21000,
    to: temporaryWallet.address,
    value: 0n
  });
  const transactionHash = await rpc(validators[0].rpcPort, 'eth_sendRawTransaction', [signedTransaction]);
  const receipt = await waitFor(async () => {
    const result = await rpc(validators[0].rpcPort, 'eth_getTransactionReceipt', [transactionHash]);
    return result || false;
  }, 'EIP-1559 transaction receipt');
  const block = await rpc(validators[0].rpcPort, 'eth_getBlockByHash', [receipt.blockHash, false]);
  if (BigInt(block.baseFeePerGas) !== 0n) throw new Error(`Expected zero base fee, got ${block.baseFeePerGas}`);
  const proposer = block.miner.toLowerCase();
  const proposerValidator = validators.find((validator) => computeAddress(
    fs.readFileSync(validator.privateKeyPath, 'utf8').trim()
  ).toLowerCase() === proposer);
  if (!proposerValidator) throw new Error(`Block proposer is not one of the FEM validators: ${proposer}`);
  const gasUsed = BigInt(receipt.gasUsed);
  const effectiveGasPrice = BigInt(receipt.effectiveGasPrice);
  if (effectiveGasPrice !== 1000000000n) {
    throw new Error(`Expected 1 Gwei effective gas price, got ${effectiveGasPrice}`);
  }
  const proposerBalance = await rpc(validators[0].rpcPort, 'eth_getBalance', [proposer, 'latest']);
  if (BigInt(proposerBalance) !== gasUsed * effectiveGasPrice) {
    throw new Error(`Proposer fee credit mismatch: balance=${proposerBalance}, gasUsed=${gasUsed}`);
  }
  console.log(`EIP-1559 fee test passed: base fee 0; proposer ${proposer} credited ${gasUsed * effectiveGasPrice} wei.`);
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
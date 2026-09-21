const fs = require('fs');
const http = require('http');
const path = require('path');

const rpcUrl = process.argv[2];
const genesisPath = process.argv[3] || path.resolve(__dirname, '..', 'genesis-final.json');
const outputPath = process.argv[4] || path.resolve(__dirname, '..', 'genesis-hash.json');
if (!rpcUrl) throw new Error('Usage: node scripts/record-genesis-hash.js http://127.0.0.1:8545 [genesis.json] [output.json]');
const url = new URL(rpcUrl);
const request = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getBlockByNumber', params: ['0x0', false] });
const req = http.request({ hostname: url.hostname, port: url.port || 80, path: url.pathname || '/', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(request) } }, (response) => {
  let body = '';
  response.on('data', (chunk) => { body += chunk; });
  response.on('end', () => {
    const result = JSON.parse(body).result;
    if (!result || !/^0x[0-9a-f]{64}$/i.test(result.hash)) throw new Error('RPC did not return a genesis block hash');
    const genesis = JSON.parse(fs.readFileSync(path.resolve(genesisPath), 'utf8'));
    fs.writeFileSync(outputPath, `${JSON.stringify({ chainId: genesis.config.chainId, genesisFile: path.basename(genesisPath), genesisHash: result.hash }, null, 2)}\n`);
    console.log(`Recorded genesis hash: ${result.hash}`);
  });
});
req.on('error', (error) => { throw error; });
req.write(request);
req.end();
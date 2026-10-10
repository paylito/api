const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..');
const project = path.basename(root);
const local = createRequire(path.join(root, 'package.json'));
process.env.NODE_PATH = path.join(root, 'node_modules');
require('node:module').Module._initPaths();
const dist = process.env.PAYLI_TEST_BUILD || path.join(root, 'dist');
const src = path.join(dist, 'src');
process.env.SERVICE_FEE_PERCENTAGE = '0';
const loggerFile = path.join(src, 'configs/logger.js');
require.cache[loggerFile] = { id: loggerFile, filename: loggerFile, loaded: true, exports: { logger: { warn() {} } } };
const { BigNumber } = local('bignumber.js');
const { NETWORKS, TOKENS, getTokenDecimals } = require(path.join(src, 'utils/tokens'));
const { FeeConfig } = require(path.join(src, 'models/FeeConfig'));
FeeConfig.find = async () => Object.values(NETWORKS).filter(network => network.isAllowed).map(network => ({ network: network.id, minFee: '0.01' }));
const { getPricing } = require(path.join(src, 'utils/helpers'));
const rates = { ETH: 2500, USDC: 1, USDT: 1, BNB: 500, POL: 0.5 };
const order = { amount: '11.93', smartAccount: '0x' + 'bb'.repeat(20), destinationAddress: '0x' + 'cc'.repeat(20), destinationNetwork: 'base', destinationToken: 'ETH' };
let calls;
function symbolFor(address, network) {
  if (address === '0x' + '0'.repeat(40)) return network.nativeToken.symbol;
  return Object.values(TOKENS).find(token => Object.entries(token.contractAddresses || {}).some(([id, addr]) => id === network.id && addr.toLowerCase() === address.toLowerCase())).symbol;
}
function mockQuotes() {
  calls = [];
  global.fetch = async (url, options) => {
    const q = new URL(url).searchParams;
    const from = Object.values(NETWORKS).find(network => network.chainId === Number(q.get('fromChain')));
    const to = Object.values(NETWORKS).find(network => network.chainId === Number(q.get('toChain')));
    const symbol = symbolFor(q.get('fromToken'), from), dest = symbolFor(q.get('toToken'), to);
    const output = new BigNumber(q.get('fromAmount')).shiftedBy(-getTokenDecimals(symbol, from.id)).times(rates[symbol]).times('0.99').div(rates[dest]).shiftedBy(getTokenDecimals(dest, to.id)).integerValue(BigNumber.ROUND_DOWN);
    calls.push({ q, output, options });
    return { ok: true, json: async () => ({ estimate: { fromAmount: q.get('fromAmount'), toAmountMin: output.toFixed(0) }, transactionRequest: { value: '0' } }) };
  };
}
test(`${project}: every offered payment amount covers its real quoted route with zero service fee`, async () => {
  mockQuotes(); const pricing = await getPricing(order, rates);
  assert.equal(pricing.length, 6);
  for (const network of pricing) {
    for (const row of network.tokens) {
      assert.equal(row.serviceFee, '0'); assert.equal(row.serviceFeeUsd, '0');
      assert.equal(row.networkFeeUsd, network.networkFeeUsd);
      assert.ok(new BigNumber(row.total).eq(new BigNumber(row.amount).plus(row.networkFee)));
      assert.ok(new BigNumber(row.totalUsd).eq(new BigNumber(order.amount).plus(network.networkFeeUsd)));
      const net = NETWORKS[network.network];
      if (network.network === order.destinationNetwork && row.symbol === order.destinationToken) continue;
      const payRaw = new BigNumber(row.total).shiftedBy(getTokenDecimals(row.symbol, network.network));
      const output = payRaw.shiftedBy(-getTokenDecimals(row.symbol, network.network)).times(rates[row.symbol]).times('0.99').div(rates.ETH).shiftedBy(18).integerValue(BigNumber.ROUND_DOWN);
      assert.ok(output.gte(new BigNumber(order.amount).div(rates.ETH).shiftedBy(18).integerValue(BigNumber.ROUND_UP)), `${network.network}/${row.symbol}`);
    }
  }
  const bscQuote = calls.find(({ q }) => q.get('fromChain') === '56' && q.get('fromToken') !== '0x' + '0'.repeat(40));
  assert.ok(BigInt(bscQuote.q.get('fromAmount')) > 10n ** 18n, 'BSC USDC uses 18 raw decimals');
});
test(`${project}: LI.FI quote requests authenticate with the configured API key`, async (t) => {
  const originalKey = process.env.LIFI_API_KEY;
  const originalFetch = global.fetch;
  t.after(() => {
    global.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.LIFI_API_KEY;
    else process.env.LIFI_API_KEY = originalKey;
  });
  for (const apiKey of [' test-lifi-api-key ', undefined, '   ']) {
    if (apiKey === undefined) delete process.env.LIFI_API_KEY;
    else process.env.LIFI_API_KEY = apiKey;
    mockQuotes();
    const pricing = await getPricing(order, rates);
    assert.equal(pricing.length, 6);
    assert.ok(calls.length > 0);
    for (const { q, options } of calls) {
      assert.equal(new Headers(options.headers).get('x-lifi-api-key'), apiKey?.trim() || null);
      assert.ok(!q.toString().includes('test-lifi-api-key'), 'API keys must stay out of the URL');
    }
  }
});
test(`${project}: unavailable routes are excluded while direct payouts remain payable`, async () => {
  global.fetch = async () => ({ ok: false, status: 404 });
  const pricing = await getPricing({ ...order, destinationToken: 'USDC' }, rates);
  assert.deepEqual(pricing.map(network => network.network), ['base']);
  assert.deepEqual(pricing[0].tokens.map(token => token.symbol), ['USDC']);
});
test(`${project}: an order with no executable payment methods cannot be created`, async () => {
  global.fetch = async () => ({ ok: false, status: 404 });
  await assert.rejects(() => getPricing({ ...order, destinationToken: 'USDT' }, rates), /No executable payment routes/);
});

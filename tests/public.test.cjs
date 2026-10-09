const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const mongoose = require('mongoose');
const { publicPayment } = require('../dist/src/services/publicActivity');
const { payerTransactions } = require('../dist/src/services/payerTransactions');
const { getPublicOverview, getPublicPayments } = require('../dist/src/controllers/publicController');
const { Order } = require('../dist/src/models/Order');
const { adminAuth } = require('../dist/src/middlewares/adminAuth');
const { signJwt } = require('../dist/src/utils/jwt');
const { openApiDocument } = require('../dist/src/configs/swagger');
const hash = (n) => `0x${n.toString(16).padStart(64, '0')}`;
const row = (n = 1) => ({ _id: `internal-id-${n}`, amountUsd: 10, createdAt: '2026-10-01T00:00:00Z', activityDate: '2026-10-02T00:00:00Z', destinationNetwork: 'base', destinationToken: 'USDC', publicStatus: 'completed', legCount: 3, pay: { network: 'ethereum', chainId: 1, token: 'USDC', tokenAddress: '0x' + 'a'.repeat(40), smartAccount: '0x' + n.toString(16).padStart(40, '0'), detectedAmount: '10.2', detectedAtBlock: 1000, sweepTxHash: hash(2) }, lifi: { toChainId: 8453, fromChainId: 1, receivingTxHash: hash(3) }, username: 'PRIVATE_NAME', privateKey: 'PRIVATE_KEY', destinationAddress: 'PRIVATE_WALLET' });
let server;
let base;
before(async () => {
  process.env.ADMIN_ID = 'test-id'; process.env.ADMIN_SECRET = 'test-secret'; process.env.ADMIN_JWT_SECRET = 'test-jwt-key';
  const app = express();
  app.get('/public/overview', getPublicOverview);
  app.get('/public/payments', getPublicPayments);
  app.get('/admin/overview', adminAuth, (_req, res) => res.json({ success: true }));
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { if (server) await new Promise((resolve) => server.close(resolve)); });

test('public mapping returns only allowed fields and chain-specific transaction links', () => {
  const mapped = publicPayment(row(), [hash(1), hash(1), 'javascript:bad']);
  assert.deepEqual(Object.keys(mapped).sort(), ['id', 'status', 'dateISO', 'amountUsd', 'volumeUsd', 'transferLegs', 'source', 'destination', 'payerTransactions', 'payerHashStatus', 'sourceTransaction', 'destinationTransaction'].sort());
  assert.match(mapped.id, /^[a-f0-9]{24}$/);
  assert.equal(mapped.volumeUsd, 30);
  assert.equal(mapped.payerTransactions.length, 1);
  assert.match(mapped.sourceTransaction.explorerUrl, /^https:\/\/etherscan.io\/tx\//);
  assert.match(mapped.destinationTransaction.explorerUrl, /^https:\/\/basescan.org\/tx\//);
  assert.doesNotMatch(JSON.stringify(mapped), /PRIVATE|internal-id|smartAccount|tokenAddress|destinationAddress|username|privateKey/);
});
test('unavailable payer hashes stay unavailable; pending/refunded delivery has no destination hash', () => {
  const pending = publicPayment({ ...row(), publicStatus: 'pending' });
  assert.deepEqual(pending.payerTransactions, []);
  assert.equal(pending.payerHashStatus, 'unavailable');
  assert.equal(publicPayment(row(), ['invalid-hash']).payerHashStatus, 'unavailable');
  assert.equal(pending.destinationTransaction, null);
  assert.equal(publicPayment({ ...row(), publicStatus: 'failed' }).destinationTransaction, null);
});
test('invalid stored transaction hashes never become public links', () => {
  const r = row(); r.pay.sweepTxHash = 'javascript:alert(1)'; r.lifi.receivingTxHash = 'PRIVATE_HASH';
  const mapped = publicPayment(r);
  assert.equal(mapped.sourceTransaction, null); assert.equal(mapped.destinationTransaction, null);
});
test('a confirmed LI.FI swap without receiving hash does not substitute the source hash', () => {
  const r = row(); r.lifi.toChainId = 1; r.lifi.receivingTxHash = undefined; r.destinationNetwork = 'ethereum'; r.destinationToken = 'ETH';
  assert.equal(publicPayment(r).destinationTransaction, null);
});
test('payer recovery validates destination, token, time, hashes and caches successful results', async () => {
  const original = global.fetch;
  const originalKey = process.env.ALCHEMY_API_KEY;
  process.env.ALCHEMY_API_KEY = 'fake-key-for-test';
  const r = row(101);
  let calls = 0;
  global.fetch = async (_url, options) => {
    calls += 1;
    const params = JSON.parse(options.body).params[0];
    assert.equal(params.toAddress, r.pay.smartAccount); assert.equal(params.toBlock, '0x3e8');
    assert.deepEqual(params.contractAddresses, [r.pay.tokenAddress]);
    const transfer = { hash: hash(101), to: r.pay.smartAccount, rawContract: { address: r.pay.tokenAddress }, metadata: { blockTimestamp: '2026-10-01T00:01:00Z' } };
    return { ok: true, json: async () => ({ result: { transfers: [transfer, transfer, { ...transfer, hash: hash(102), to: 'wrong-address' }, { ...transfer, hash: hash(103), rawContract: { address: 'wrong-token' } }, { ...transfer, hash: hash(104), metadata: { blockTimestamp: '2026-09-30T00:01:00Z' } }] } }) };
  };
  try { assert.deepEqual(await payerTransactions(r), [hash(101)]); assert.deepEqual(await payerTransactions(r), [hash(101)]); assert.equal(calls, 1); }
  finally { global.fetch = original; if (originalKey === undefined) delete process.env.ALCHEMY_API_KEY; else process.env.ALCHEMY_API_KEY = originalKey; }
});
test('payer provider failures and truncated histories fail closed', async () => {
  const original = global.fetch;
  const originalKey = process.env.ALCHEMY_API_KEY;
  process.env.ALCHEMY_API_KEY = 'fake-key-for-test';
  try {
    global.fetch = async () => { throw new Error('PRIVATE_PROVIDER_URL'); };
    assert.deepEqual(await payerTransactions(row(201)), []);
    global.fetch = async () => ({ ok: true, json: async () => ({ result: { pageKey: 'more', transfers: [{ hash: hash(1) }] } }) });
    assert.deepEqual(await payerTransactions(row(202)), []);
  } finally { global.fetch = original; if (originalKey === undefined) delete process.env.ALCHEMY_API_KEY; else process.env.ALCHEMY_API_KEY = originalKey; }
});
test('public routes reject identity probes, injection, duplicate query keys, invalid dates and pagination', async () => {
  for (const query of ['merchantId=PRIVATE_NAME', 'username=PRIVATE_NAME', 'page=0', 'page=1.5', 'page=99999999999999999999', 'limit=26', 'limit=-1', 'date=2026-02-31', 'date=invalid', 'status=unknown', 'asset=%24where', 'network%5B%24ne%5D=x', 'asset=USDC&asset=ETH']) {
    const response = await fetch(`${base}/public/payments?${query}`);
    assert.equal(response.status, 400, query); assert.doesNotMatch(JSON.stringify(await response.json()), /PRIVATE_NAME/);
  }
});
test('admin access still requires a valid JWT', async () => {
  assert.equal((await fetch(`${base}/admin/overview`)).status, 401);
  assert.equal((await fetch(`${base}/admin/overview`, { headers: { Authorization: 'Bearer invalid' } })).status, 401);
  const { token } = signJwt({ sub: 'admin' }, process.env.ADMIN_JWT_SECRET, 300);
  assert.equal((await fetch(`${base}/admin/overview`, { headers: { Authorization: `Bearer ${token}` } })).status, 200);
});
test('public failures omit raw database/internal error details', async () => {
  const original = Order.aggregate;
  Order.aggregate = async () => { throw new Error('PRIVATE_DATABASE_ERROR'); };
  try { const response = await fetch(`${base}/public/payments`); assert.equal(response.status, 500); assert.deepEqual(await response.json(), { success: false, message: 'Public activity is temporarily unavailable.' }); }
  finally { Order.aggregate = original; }
});
test('Swagger has both unauthenticated routes and fully defined public schemas', () => {
  for (const path of ['/public/overview', '/public/payments']) { assert.deepEqual(openApiDocument.paths[path].get.security, []); assert.ok(openApiDocument.paths[path].get.responses['200']); }
  const doc = JSON.stringify(openApiDocument);
  for (const [, name] of doc.matchAll(/#\/components\/schemas\/([^"\s]+)/g)) assert.ok(openApiDocument.components.schemas[name], name);
  assert.equal(openApiDocument.components.schemas.PublicPayment.additionalProperties, false);
  assert.match(openApiDocument.paths['/public/overview'].get.description, /not.*unique payers/);
});

test('MongoDB: real aggregation, pagination, privacy, delivery status, duplicates and volume', { skip: !process.env.PUBLIC_TEST_DB_URI }, async (t) => {
  const dbName = `korre_public_test_${process.pid}_${Date.now()}`;
  assert.match(dbName, /^korre_public_test_\d+_\d+$/);
  const oldKey = process.env.ALCHEMY_API_KEY;
  delete process.env.ALCHEMY_API_KEY; // Integration fixtures never call real providers.
  await mongoose.connect(process.env.PUBLIC_TEST_DB_URI, { dbName, serverSelectionTimeoutMS: 5000 });
  const db = mongoose.connection.db;
  try {
    const uid = new mongoose.Types.ObjectId();
    await db.collection('users').insertMany([{ _id: uid, username: 'PRIVATE_PERSON', chatId: 'PRIVATE_CHAT' }, { is_waitlist: true, name: 'PRIVATE_WAITLIST' }]);
    const now = new Date();
    const specs = [
      { amount: '10', status: 'finished', sweep: 1, receiving: 2, to: 8453, lifi: 'DONE', substatus: 'COMPLETED' },
      { amount: '20', status: 'finished', sweep: 3, receiving: 3, to: 1, lifi: 'DONE', substatus: 'COMPLETED' },
      { amount: '8', status: 'processing' },
      { amount: '12', status: 'finished', sweep: 4, to: 8453, lifi: 'PENDING' },
      { amount: '15', status: 'finished', sweep: 5, receiving: 6, to: 8453, lifi: 'DONE', substatus: 'REFUNDED' },
      { amount: '999999', status: 'pending', noPayment: true },
      { amount: '999999', status: 'finished', zero: true },
      { amount: 'bad-number', status: 'processing' },
      { amount: '5', status: 'finished', sweep: 7, receiving: 7, to: 1, lifi: 'DONE', substatus: 'COMPLETED', destinationToken: 'ETH' },
      { amount: '10', status: 'finished', sweep: 8, to: 8453 }, // Cross-chain delivery audit not created yet.
      { amount: '10', status: 'finished', sweep: 9, to: 1, destinationToken: 'ETH' }, // Swap audit not created yet.
      { amount: '10', status: 'finished', sweep: 10, to: 1 }, // Direct same-asset forwarding.
      { amount: '10', status: 'finished', sweep: 11, to: 1, lifi: 'DONE', substatus: 'COMPLETED', destinationToken: 'ETH' }, // Confirmed swap, hash missing.
    ];
    for (let i = 0; i < specs.length; i++) {
      const spec = specs[i]; const oid = new mongoose.Types.ObjectId();
      await db.collection('orders').insertOne({ _id: oid, id: `PRIVATE_ORDER_${i}`, user: uid, privateKey: 'PRIVATE_KEY', destinationAddress: 'PRIVATE_DEST', text: 'PRIVATE_MESSAGE', amount: spec.amount, status: spec.status, createdAt: now, paidAt: spec.status === 'finished' ? now : undefined, destinationToken: spec.destinationToken ?? 'USDC', destinationNetwork: spec.to === 1 ? 'ethereum' : 'base' });
      if (!spec.noPayment) await db.collection('payments').insertOne({ order: oid, network: 'ethereum', chainId: 1, token: 'USDC', detectedAmount: spec.zero ? '0' : '10', smartAccount: 'PRIVATE_SMART_ACCOUNT', sweepTxHash: spec.sweep ? hash(spec.sweep) : undefined });
      if (spec.lifi) await db.collection('lifitransactions').insertOne({ order: oid, fromChainId: 1, toChainId: spec.to, sendingTxHash: spec.sweep ? hash(spec.sweep) : undefined, receivingTxHash: spec.receiving ? hash(spec.receiving) : undefined, status: spec.lifi, substatus: spec.substatus, updatedAt: now, quote: { secret: 'PRIVATE_RAW' } });
      if (i === 0) await db.collection('lifitransactions').insertOne({ order: oid, fromChainId: 1, toChainId: 8453, status: 'PENDING', updatedAt: new Date('2020-01-01') });
    }
    await t.test('metrics use actual observed legs and exclude unfunded orders', async () => {
      const response = await fetch(`${base}/public/overview`); assert.equal(response.status, 200);
      const { data } = await response.json();
      assert.equal(data.totalUsers, 2); assert.equal(data.totalPayments, 11); assert.equal(data.completedPayments, 5);
      assert.equal(data.paymentVolume, 55); assert.equal(data.totalVolume, 227); assert.equal(data.transferLegs, 22);
      assert.equal(data.avgPaymentValue, 11); assert.equal(data.dailyPayments, 5); assert.equal(data.successRate, 83.33);
      assert.equal(data.volumeSeries.length, 30); assert.equal(data.volumeSeries.at(-1).volume, 227);
      assert.equal(data.recentPayments.length, 5); assert.doesNotMatch(JSON.stringify(data), /PRIVATE_/);
    });
    await t.test('pages have exact totals and no duplicates from retry lookups', async () => {
      const seen = new Set();
      for (let page = 1; page <= 6; page++) {
        const response = await fetch(`${base}/public/payments?page=${page}&limit=2`); assert.equal(response.status, 200);
        const body = await response.json(); assert.equal(body.pagination.total, 11); assert.equal(body.data.length, page === 6 ? 1 : 2);
        for (const payment of body.data) { assert.ok(!seen.has(payment.id)); seen.add(payment.id); }
        assert.doesNotMatch(JSON.stringify(body), /PRIVATE_|username|privateKey|smartAccount|destinationAddress|orderId/);
      }
      assert.equal(seen.size, 11);
      const beyond = await (await fetch(`${base}/public/payments?page=20&limit=2`)).json();
      assert.deepEqual(beyond.data, []); assert.equal(beyond.pagination.from, 0); assert.equal(beyond.pagination.to, 0);
    });
    await t.test('source/date/status filters and unconfirmed/refunded delivery', async () => {
      const body = await (await fetch(`${base}/public/payments?asset=usdc&network=Ethereum&status=completed&date=${now.toISOString().slice(0, 10)}`)).json();
      assert.equal(body.data.length, 5); assert.equal(body.pagination.total, 5);
      assert.deepEqual(body.data.map((p) => p.transferLegs).sort(), [2, 2, 2, 3, 3]);
      for (const status of ['pending', 'failed']) { const result = await (await fetch(`${base}/public/payments?status=${status}`)).json(); assert.ok(result.data.length); assert.ok(result.data.every((p) => p.destinationTransaction === null)); }
      const empty = await (await fetch(`${base}/public/payments?asset=BTC`)).json(); assert.deepEqual(empty.data, []); assert.equal(empty.pagination.total, 0);
    });
    await t.test('missing route audits stay pending; confirmed swaps without hashes do not invent delivery links', async () => {
      const body = await (await fetch(`${base}/public/payments?limit=25`)).json();
      const find = (sweep) => body.data.find((p) => p.sourceTransaction?.hash === hash(sweep));
      assert.equal(find(8).status, 'pending'); assert.equal(find(8).destinationTransaction, null);
      assert.equal(find(9).status, 'pending'); assert.equal(find(9).destinationTransaction, null);
      assert.equal(find(10).status, 'completed'); assert.equal(find(10).destinationTransaction.hash, hash(10)); assert.equal(find(10).transferLegs, 2);
      assert.equal(find(11).status, 'completed'); assert.equal(find(11).destinationTransaction, null); assert.equal(find(11).transferLegs, 2);
    });
    await t.test('empty database returns truthful zero metrics', async () => {
      await db.collection('orders').deleteMany({}); await db.collection('users').deleteMany({});
      const body = await (await fetch(`${base}/public/overview`)).json();
      assert.equal(body.data.totalVolume, 0); assert.equal(body.data.totalPayments, 0); assert.equal(body.data.totalUsers, 0); assert.deepEqual(body.data.recentPayments, []);
    });
  } finally { await db.dropDatabase(); await mongoose.disconnect(); if (oldKey === undefined) delete process.env.ALCHEMY_API_KEY; else process.env.ALCHEMY_API_KEY = oldKey; }
});

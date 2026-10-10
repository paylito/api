const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');
const dist = path.resolve(__dirname, '../dist/src');
const { lifiRequest, getLifiConfig } = require(path.join(dist, 'utils/lifiRequest'));

test('LI.FI quote and status share trimmed authentication without leaking keys into URLs', async t => {
  const savedFetch = global.fetch, savedKey = process.env.LIFI_API_KEY, savedIntegrator = process.env.LIFI_INTEGRATOR;
  t.after(() => {
    global.fetch = savedFetch;
    for (const [name, value] of [['LIFI_API_KEY', savedKey], ['LIFI_INTEGRATOR', savedIntegrator]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  });
  process.env.LIFI_INTEGRATOR = ' payli ';
  assert.equal(getLifiConfig().integrator, 'payli');
  for (const key of [' test-private-key ', '', '   ']) {
    process.env.LIFI_API_KEY = key;
    global.fetch = async (url, options) => {
      assert.equal(new Headers(options.headers).get('x-lifi-api-key'), key.trim() || null);
      assert.ok(!url.includes('test-private-key'));
      assert.ok(options.signal instanceof AbortSignal);
      return { ok: true };
    };
    for (const endpoint of ['quote', 'status']) assert.equal((await lifiRequest(endpoint, new URLSearchParams(), 1000)).ok, true);
  }
});

test('LI.FI 401 stays a failure, reports runtime configuration, and never leaks or retries the key', async t => {
  const savedFetch = global.fetch, savedKey = process.env.LIFI_API_KEY;
  t.after(() => { global.fetch = savedFetch; if (savedKey === undefined) delete process.env.LIFI_API_KEY; else process.env.LIFI_API_KEY = savedKey; });
  process.env.LIFI_API_KEY = 'test-private-key';
  let calls = 0;
  global.fetch = async () => { calls++; return new Response(JSON.stringify({ message: 'Invalid API key test-private-key' }), { status: 401 }); };
  await assert.rejects(lifiRequest('quote', new URLSearchParams(), 1000), error => {
    assert.match(error.message, /401.*Invalid API key \[redacted\]/);
    assert.match(error.message, /runtime LIFI_API_KEY \(configured\)/);
    assert.ok(!error.message.includes('test-private-key'));
    return true;
  });
  assert.equal(calls, 1);
  delete process.env.LIFI_API_KEY;
  await assert.rejects(lifiRequest('quote', new URLSearchParams(), 1000), /runtime LIFI_API_KEY \(missing\)/);
});

test('LI.FI preserves non-auth failures and handles non-JSON error responses', async t => {
  const savedFetch = global.fetch;
  t.after(() => { global.fetch = savedFetch; });
  global.fetch = async () => new Response('Forbidden', { status: 403 });
  await assert.rejects(lifiRequest('status', new URLSearchParams(), 1000), /403.*IP and integrator restrictions/);
  global.fetch = async () => new Response(JSON.stringify({ message: 'No route found' }), { status: 404 });
  await assert.rejects(lifiRequest('quote', new URLSearchParams(), 1000), /404.*No route found/);
});

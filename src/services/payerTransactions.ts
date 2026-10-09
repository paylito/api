import { NETWORKS, txHash } from './publicActivity';
import type { ActivityRow } from './publicActivity';

interface Transfer {
  hash: string;
  to?: string;
  asset?: string;
  rawContract?: { address?: string | null };
  metadata?: { blockTimestamp?: string };
}

// Bound both provider usage and memory. Misses retry after five minutes; known
// historical deposits are immutable and stay cached for one day.
const cache = new Map<string, { expires: number; result: Promise<string[]> }>();
let active = 0;
const MAX_ACTIVE = 4;

export async function payerTransactions(row: ActivityRow): Promise<string[]> {
  const network = NETWORKS[row.pay.chainId];
  const key = process.env.ALCHEMY_API_KEY;
  if (!network || !key || !/^0x[0-9a-fA-F]{40}$/.test(row.pay.smartAccount) || !Number.isSafeInteger(row.pay.detectedAtBlock) || row.pay.detectedAtBlock <= 0) return [];
  const cacheKey = `${row.pay.chainId}:${row.pay.smartAccount.toLowerCase()}:${row.pay.token}:${row.pay.detectedAtBlock}`;
  const existing = cache.get(cacheKey);
  if (existing && existing.expires > Date.now()) return existing.result;
  // The route processes a page in batches of four. This additionally bounds
  // concurrent requests across visitors without an unbounded waiting queue.
  if (active >= MAX_ACTIVE) return [];
  if (cache.size >= 5000) cache.delete(cache.keys().next().value as string);
  active += 1;
  const entry = { expires: Date.now() + 300_000, result: Promise.resolve([] as string[]) };
  entry.result = (async () => {
    try {
      const native = row.pay.token === 'ETH';
      if (!native && !row.pay.tokenAddress) return [];
      const res = await fetch(`https://${network.alchemy}.g.alchemy.com/v2/${encodeURIComponent(key)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(4000),
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'alchemy_getAssetTransfers', params: [{
          fromBlock: '0x0', toBlock: `0x${row.pay.detectedAtBlock.toString(16)}`, toAddress: row.pay.smartAccount,
          category: native ? ['external', ...(row.pay.chainId === 1 || row.pay.chainId === 137 ? ['internal'] : [])] : ['erc20'],
          ...(native ? {} : { contractAddresses: [row.pay.tokenAddress] }),
          excludeZeroValue: true, withMetadata: true, order: 'desc', maxCount: '0x64',
        }] }),
      });
      if (!res.ok) return [];
      const body = await res.json() as { result?: { transfers?: Transfer[]; pageKey?: string }; error?: unknown };
      // Do not claim a complete payer history if the provider truncated it.
      if (body.error || body.result?.pageKey) return [];
      const hashes = (body.result?.transfers ?? []).filter((t) => {
        const timestamp = Date.parse(t.metadata?.blockTimestamp ?? '');
        return t.to?.toLowerCase() === row.pay.smartAccount.toLowerCase() &&
          Number.isFinite(timestamp) && timestamp >= new Date(row.createdAt).getTime() &&
          (native ? !t.rawContract?.address : t.rawContract?.address?.toLowerCase() === row.pay.tokenAddress?.toLowerCase());
      }).map((t) => txHash(t.hash)).filter((h): h is string => h !== null);
      const result = [...new Set(hashes)];
      if (result.length) entry.expires = Date.now() + 86_400_000;
      return result;
    } catch {
      // No upstream bodies, API keys, URLs, or wallet addresses in public errors.
      return [];
    } finally {
      active -= 1;
    }
  })();
  cache.set(cacheKey, entry);
  return entry.result;
}

export async function enrichPayments(rows: ActivityRow[]) {
  const out = [];
  for (let i = 0; i < rows.length; i += MAX_ACTIVE) {
    const batch = rows.slice(i, i + MAX_ACTIVE);
    out.push(...await Promise.all(batch.map(async (row) => ({ row, hashes: await payerTransactions(row) }))));
  }
  return out;
}

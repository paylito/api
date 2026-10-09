import { createHash } from 'crypto';
import type { PipelineStage, Types } from 'mongoose';

export interface ActivityRow {
  _id: Types.ObjectId | string;
  amountUsd: number;
  activityDate: Date | string;
  createdAt: Date | string;
  destinationNetwork: string;
  destinationToken: string;
  publicStatus: 'completed' | 'pending' | 'failed';
  legCount: number;
  pay: {
    network: string;
    chainId: number;
    token: string;
    tokenAddress?: string;
    smartAccount: string;
    detectedAmount: string;
    detectedAtBlock: number;
    sweepTxHash?: string;
  };
  lifi?: { fromChainId: number; toChainId: number; sendingTxHash?: string; receivingTxHash?: string };
}

export const NETWORKS: Record<number, { name: string; explorer: string; alchemy: string }> = {
  1: { name: 'ethereum', explorer: 'https://etherscan.io/tx/', alchemy: 'eth-mainnet' },
  10: { name: 'optimism', explorer: 'https://optimistic.etherscan.io/tx/', alchemy: 'opt-mainnet' },
  56: { name: 'bsc', explorer: 'https://bscscan.com/tx/', alchemy: 'bnb-mainnet' },
  137: { name: 'polygon', explorer: 'https://polygonscan.com/tx/', alchemy: 'polygon-mainnet' },
  8453: { name: 'base', explorer: 'https://basescan.org/tx/', alchemy: 'base-mainnet' },
  42161: { name: 'arbitrum', explorer: 'https://arbiscan.io/tx/', alchemy: 'arb-mainnet' },
  42220: { name: 'celo', explorer: 'https://celoscan.io/tx/', alchemy: 'celo-mainnet' },
};

const validHashExpression = (input: string) => ({
  $regexMatch: { input: { $ifNull: [input, ''] }, regex: '^0x[0-9a-fA-F]{64}$' },
});

// Only load fields needed for public activity. Never hydrate users, donation
// links, private keys, messages, receipts, or raw LI.FI quotes/status payloads.
export const activityPipeline = (): PipelineStage[] => [
  { $project: { amount: 1, createdAt: 1, paidAt: 1, status: 1, destinationNetwork: 1, destinationToken: 1 } },
  {
    $lookup: {
      from: 'payments', localField: '_id', foreignField: 'order', as: 'pay',
      pipeline: [{ $project: { network: 1, chainId: 1, token: 1, tokenAddress: 1, smartAccount: 1, detectedAmount: 1, detectedAtBlock: 1, sweepTxHash: 1 } }, { $limit: 1 }],
    },
  },
  { $unwind: '$pay' },
  { $match: { $expr: { $gt: [{ $convert: { input: '$pay.detectedAmount', to: 'double', onError: 0, onNull: 0 } }, 0] } } },
  {
    $lookup: {
      from: 'lifitransactions', localField: '_id', foreignField: 'order', as: 'lifi',
      pipeline: [{ $sort: { updatedAt: -1, _id: -1 } }, { $limit: 1 }, { $project: { fromChainId: 1, toChainId: 1, sendingTxHash: 1, receivingTxHash: 1, status: 1, substatus: 1 } }],
    },
  },
  { $unwind: { path: '$lifi', preserveNullAndEmptyArrays: true } },
  {
    $set: {
      amountUsd: { $max: [0, { $convert: { input: '$amount', to: 'double', onError: 0, onNull: 0 } }] },
      activityDate: { $ifNull: ['$paidAt', '$createdAt'] },
      publicStatus: {
        $switch: {
          branches: [
            { case: { $or: [{ $in: ['$status', ['failed', 'expired']] }, { $eq: ['$lifi.status', 'FAILED'] }, { $in: ['$lifi.substatus', ['REFUNDED', 'PARTIAL']] }] }, then: 'failed' },
            { case: { $and: [{ $eq: ['$status', 'finished'] }, { $or: [{ $and: [{ $eq: [{ $ifNull: ['$lifi', null] }, null] }, { $eq: ['$destinationNetwork', '$pay.network'] }, { $eq: ['$destinationToken', '$pay.token'] }, validHashExpression('$pay.sweepTxHash')] }, { $and: [{ $eq: ['$lifi.status', 'DONE'] }, { $eq: ['$lifi.substatus', 'COMPLETED'] }] }] }] }, then: 'completed' },
          ],
          default: 'pending',
        },
      },
      sourceHash: { $cond: [validHashExpression('$pay.sweepTxHash'), '$pay.sweepTxHash', '$lifi.sendingTxHash'] },
    },
  },
  {
    $set: {
      legCount: {
        $add: [
          1, // An observed positive deposit, even if its hash is not recoverable.
          { $cond: [validHashExpression('$sourceHash'), 1, 0] },
          {
            $cond: [
              { $and: [{ $eq: ['$publicStatus', 'completed'] }, validHashExpression('$lifi.receivingTxHash'), { $or: [{ $ne: ['$pay.chainId', '$lifi.toChainId'] }, { $ne: [{ $toLower: '$sourceHash' }, { $toLower: '$lifi.receivingTxHash' }] }, { $ne: ['$pay.token', '$destinationToken'] }] }] },
              1, 0,
            ],
          },
        ],
      },
    },
  },
];

export const txHash = (value: unknown): string | null =>
  typeof value === 'string' && /^0x[0-9a-fA-F]{64}$/.test(value) ? value : null;

export const transaction = (hash: string, chainId: number) => ({
  hash, chainId, explorerUrl: NETWORKS[chainId] ? NETWORKS[chainId].explorer + hash : null,
});

export function publicPayment(row: ActivityRow, payerHashes: string[] = []) {
  const sourceChainId = row.pay.chainId;
  const destinationChainId = (row.lifi?.toChainId ??
    Number(Object.entries(NETWORKS).find(([, n]) => n.name === row.destinationNetwork)?.[0])) || null;
  const sourceHash = txHash(row.pay.sweepTxHash) ?? txHash(row.lifi?.sendingTxHash);
  const destinationHash = row.publicStatus === 'completed' ? txHash(row.lifi?.receivingTxHash) ??
    (!row.lifi && destinationChainId === sourceChainId && row.destinationToken === row.pay.token ? sourceHash : null) : null;
  const date = new Date(row.activityDate).toISOString();
  const payerTransactions = [...new Set(payerHashes.map(txHash).filter((h): h is string => h !== null))].map((h) => transaction(h, sourceChainId));
  return {
    id: createHash('sha256').update(`public-payment:${row._id}`).digest('hex').slice(0, 24),
    status: row.publicStatus,
    dateISO: date.slice(0, 10),
    amountUsd: row.amountUsd,
    volumeUsd: Number((row.amountUsd * row.legCount).toFixed(2)),
    transferLegs: row.legCount,
    source: { network: NETWORKS[sourceChainId]?.name ?? row.pay.network, chainId: sourceChainId, asset: row.pay.token, amount: row.pay.detectedAmount },
    destination: { network: destinationChainId ? NETWORKS[destinationChainId]?.name ?? row.destinationNetwork : row.destinationNetwork, chainId: destinationChainId, asset: row.destinationToken },
    payerTransactions,
    payerHashStatus: payerTransactions.length ? 'available' : 'unavailable',
    sourceTransaction: sourceHash ? transaction(sourceHash, sourceChainId) : null,
    destinationTransaction: destinationHash && destinationChainId ? transaction(destinationHash, destinationChainId) : null,
  };
}

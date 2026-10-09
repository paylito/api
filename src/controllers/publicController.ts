import type { Request, Response } from 'express';
import type { PipelineStage } from 'mongoose';
import { Order } from '../models/Order';
import { User } from '../models/User';
import { logger } from '../configs/logger';
import { activityPipeline, publicPayment } from '../services/publicActivity';
import type { ActivityRow } from '../services/publicActivity';
import { enrichPayments } from '../services/payerTransactions';

const round = (n: number) => Number(n.toFixed(2));
const query = (v: unknown) => typeof v === 'string' ? v.trim() : '';
const integer = (value: string, fallback: number, max: number) => {
  if (!value) return fallback;
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > max) throw new Error('Invalid pagination');
  return Number(value);
};

export async function getPublicPayments(req: Request, res: Response) {
  let page: number;
  let limit: number;
  const match: Record<string, unknown> = {};
  try {
    // Reject identity filters instead of turning public activity into a lookup
    // oracle for private merchant names or identifiers.
    if (Object.keys(req.query).some((key) => !['page', 'limit', 'asset', 'network', 'date', 'status'].includes(key)) || Object.values(req.query).some((v) => typeof v !== 'string')) throw new Error('Invalid filter');
    page = integer(query(req.query.page), 1, 100000);
    limit = integer(query(req.query.limit), 10, 25);
    for (const key of ['asset', 'network'] as const) {
      const value = query(req.query[key]);
      if (value && value !== 'any') {
        if (!/^[a-zA-Z0-9_-]{1,32}$/.test(value)) throw new Error('Invalid filter');
        match[key === 'asset' ? 'pay.token' : 'pay.network'] = new RegExp(`^${value}$`, 'i');
      }
    }
    const status = query(req.query.status);
    if (status && status !== 'any') {
      if (!['completed', 'pending', 'failed'].includes(status)) throw new Error('Invalid status');
      match.publicStatus = status;
    }
    const date = query(req.query.date);
    if (date) {
      const start = new Date(`${date}T00:00:00Z`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(start.getTime()) || start.toISOString().slice(0, 10) !== date) throw new Error('Invalid date');
      match.activityDate = { $gte: start, $lt: new Date(start.getTime() + 86400000) };
    }
  } catch {
    return res.status(400).json({ success: false, message: 'Invalid filters or pagination. Use page >= 1 and limit between 1 and 25.' });
  }
  try {
    const [result] = await Order.aggregate([
      ...activityPipeline(), { $match: match }, { $sort: { activityDate: -1, _id: -1 } },
      { $facet: { data: [{ $skip: (page - 1) * limit }, { $limit: limit }], meta: [{ $count: 'total' }] } },
    ]);
    const total = result?.meta[0]?.total ?? 0;
    const enriched = await enrichPayments((result?.data ?? []) as ActivityRow[]);
    const totalPages = Math.max(1, Math.ceil(total / limit));
    res.set('Cache-Control', 'public, max-age=30');
    return res.json({ success: true, data: enriched.map(({ row, hashes }) => publicPayment(row, hashes)), pagination: {
      page, limit, total, totalPages, hasPrev: page > 1, hasNext: page < totalPages,
      from: total === 0 || page > totalPages ? 0 : (page - 1) * limit + 1,
      to: total === 0 || page > totalPages ? 0 : Math.min(total, page * limit),
    } });
  } catch (error) {
    logger.error({ err: error }, 'Error listing public activity');
    return res.status(500).json({ success: false, message: 'Public activity is temporarily unavailable.' });
  }
}

export async function getPublicOverview(_req: Request, res: Response) {
  try {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const seriesStart = new Date(today.getTime() - 29 * 86400000);
    const completed = { $eq: ['$publicStatus', 'completed'] };
    const [aggregated, totalUsers, active] = await Promise.all([
      Order.aggregate([
        ...activityPipeline(),
        { $facet: {
          totals: [{ $group: {
            _id: null, totalPayments: { $sum: 1 }, completedPayments: { $sum: { $cond: [completed, 1, 0] } },
            failedPayments: { $sum: { $cond: [{ $eq: ['$publicStatus', 'failed'] }, 1, 0] } },
            totalVolume: { $sum: { $multiply: ['$amountUsd', '$legCount'] } },
            paymentVolume: { $sum: { $cond: [completed, '$amountUsd', 0] } },
            transferLegs: { $sum: '$legCount' },
            dailyPayments: { $sum: { $cond: [{ $and: [completed, { $gte: ['$activityDate', today] }] }, 1, 0] } },
          } }],
          methods: [{ $group: { _id: '$pay.token', amount: { $sum: '$amountUsd' }, count: { $sum: 1 } } }, { $sort: { amount: -1 } }],
          networks: [{ $group: { _id: '$pay.network', volume: { $sum: { $multiply: ['$amountUsd', '$legCount'] } }, payments: { $sum: 1 } } }, { $sort: { volume: -1 } }],
          series: [{ $match: { activityDate: { $gte: seriesStart } } }, { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$activityDate', timezone: 'UTC' } }, volume: { $sum: { $multiply: ['$amountUsd', '$legCount'] } } } }],
          recent: [{ $sort: { activityDate: -1, _id: -1 } }, { $limit: 5 }],
        } } as PipelineStage,
      ]),
      User.countDocuments(),
      Order.aggregate([{ $match: { status: 'finished' } }, { $group: { _id: '$user' } }, { $count: 'count' }]),
    ]);
    const result = aggregated[0];
    const totals = result?.totals[0] ?? {};
    const totalPayments = totals.totalPayments ?? 0;
    const completedPayments = totals.completedPayments ?? 0;
    const terminal = completedPayments + (totals.failedPayments ?? 0);
    const methodsTotal = (result?.methods ?? []).reduce((sum: number, m: { amount: number }) => sum + m.amount, 0);
    const series = new Map<string, number>((result?.series ?? []).map((s: { _id: string; volume: number }) => [s._id, s.volume]));
    const recent = await enrichPayments((result?.recent ?? []) as ActivityRow[]);
    res.set('Cache-Control', 'public, max-age=30');
    return res.json({ success: true, data: {
      totalVolume: round(totals.totalVolume ?? 0), paymentVolume: round(totals.paymentVolume ?? 0),
      totalPayments, completedPayments, transferLegs: totals.transferLegs ?? 0, totalUsers,
      activeMerchants: active[0]?.count ?? 0, dailyPayments: totals.dailyPayments ?? 0,
      avgPaymentValue: completedPayments ? round(totals.paymentVolume / completedPayments) : 0,
      successRate: terminal ? round(completedPayments / terminal * 100) : 0,
      volumeDefinition: 'Gross transfer volume sums each funded payment\'s reference USD amount once per observed deposit, recorded source execution, and confirmed destination delivery. A completed same-chain swap counts its input and output as separate legs even when they share a transaction hash; a same-asset delivery sharing its source hash counts once. The same funds may be counted up to three times. Fees, slippage, and exchange-rate changes are not separate volume. Payment volume counts completed payments once.',
      userDefinition: 'Registered accounts, including waitlist accounts. Payer identities are not tracked; this is not a unique-payer count.',
      paymentMethods: (result?.methods ?? []).map((m: { _id: string; amount: number; count: number }) => ({ asset: m._id, amount: round(m.amount), count: m.count, pct: methodsTotal ? round(m.amount / methodsTotal * 100) : 0 })),
      networks: (result?.networks ?? []).map((n: { _id: string; volume: number; payments: number }) => ({ network: n._id, volume: round(n.volume), payments: n.payments })),
      volumeSeries: Array.from({ length: 30 }, (_, i) => { const date = new Date(seriesStart.getTime() + i * 86400000).toISOString().slice(0, 10); return { date, volume: round(series.get(date) ?? 0) }; }),
      recentPayments: recent.map(({ row, hashes }) => publicPayment(row, hashes)),
    } });
  } catch (error) {
    logger.error({ err: error }, 'Error building public overview');
    return res.status(500).json({ success: false, message: 'Public metrics are temporarily unavailable.' });
  }
}

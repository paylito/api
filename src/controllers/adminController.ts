import { Request, Response } from 'express';
import { Types, isValidObjectId, PipelineStage } from 'mongoose';

import { User } from '../models/User';
import { Order } from '../models/Order';
import { logger } from '../configs/logger';
import { getServiceFee } from '../utils/helpers';
import { DonationLink } from '../models/DonationLink';
import { signJwt, safeEqual } from '../utils/jwt';
import { getAdminConfig, isAdminConfigured } from '../configs/admin';

// --- status mapping -------------------------------------------------------
//
// The dashboard speaks three statuses (completed / pending / failed); the Order
// model has six. These tables translate between the two in both directions.
const FINISHED = 'finished';
const DASHBOARD_STATUS_GROUPS: Record<string, string[]> = {
  completed: ['finished'],
  pending: ['pending', 'processing', 'manual_review'],
  failed: ['failed', 'expired'],
};
const RAW_ORDER_STATUSES = [
  'pending',
  'processing',
  'finished',
  'expired',
  'failed',
  'manual_review',
];

const mapDashboardStatus = (orderStatus: string): 'completed' | 'pending' | 'failed' => {
  if (orderStatus === 'finished') return 'completed';
  if (orderStatus === 'failed' || orderStatus === 'expired') return 'failed';

  return 'pending';
};

// --- small formatting helpers --------------------------------------------
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

// "jun 18, 2026" (matches the design's lowercase short-month display).
const formatDate = (d: Date | string): string => {
  const dt = new Date(d);

  return `${MONTHS[dt.getUTCMonth()]} ${dt.getUTCDate()}, ${dt.getUTCFullYear()}`;
};

// "$1,003.00" — manual grouping so we don't depend on the runtime's ICU build.
const formatUsd = (value: number | string): string => {
  const num = Number(value) || 0;
  const [intPart, decPart] = num.toFixed(2).split('.');

  return `$${intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${decPart}`;
};

// Always render handles with a leading "@" (usernames are stored without one).
const handle = (username?: string | null): string | null => {
  if (!username) return null;

  const s = String(username).trim();

  if (!s) return null;

  return s.startsWith('@') ? s : `@${s}`;
};

const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// req.query values can be string | string[] | undefined — normalise to a string.
const queryStr = (v: unknown): string => {
  if (Array.isArray(v)) return typeof v[0] === 'string' ? v[0] : '';

  return typeof v === 'string' ? v : '';
};

// --- pagination -----------------------------------------------------------
const PER_PAGE_DEFAULT = 10;
const PER_PAGE_MAX = 100;

interface Pagination {
  page: number;
  limit: number;
  skip: number;
}

const parsePagination = (req: Request): Pagination => {
  const page = Math.max(1, parseInt(queryStr(req.query.page), 10) || 1);
  const limitRaw = parseInt(queryStr(req.query.limit), 10) || PER_PAGE_DEFAULT;
  const limit = Math.min(PER_PAGE_MAX, Math.max(1, limitRaw));

  return { page, limit, skip: (page - 1) * limit };
};

const buildMeta = (total: number, { page, limit }: Pagination) => {
  const totalPages = Math.max(1, Math.ceil(total / limit));

  return {
    page,
    limit,
    total,
    totalPages,
    hasPrev: page > 1,
    hasNext: page < totalPages,
    from: total === 0 ? 0 : (page - 1) * limit + 1,
    to: Math.min(total, page * limit),
  };
};

// --- aggregation row shapes ----------------------------------------------
//
// `Model.aggregate()` is typed `any[]`; these interfaces let the result mapping
// stay typed instead of leaning on `any`.
interface PaymentAggRow {
  id: string;
  status: string;
  amount: string;
  createdAt: Date | string;
  merchant?: { _id: Types.ObjectId; username?: string } | null;
  donationLink?: { username?: string } | null;
  pay?: { token?: string; network?: string; detectedAmount?: string } | null;
  lifi?: { receivingTxHash?: string; sendingTxHash?: string } | null;
}

interface MerchantAggRow {
  _id: Types.ObjectId;
  name?: string;
  username?: string;
  donationUsername?: string;
  payments: number;
  paidOut: number;
}

interface DonateeAggRow {
  username?: string;
  donations: number;
  raised: number;
  owner?: { username?: string } | null;
}

interface TopMerchantAggRow {
  _id: Types.ObjectId;
  payments: number;
  paidOut: number;
  user?: { name?: string; username?: string } | null;
}

// The lookups that hydrate an order into a dashboard "payment" row: the owning
// merchant (User), the settlement (Payment), the li.fi payout (LifiTransaction),
// and the source donation link. Shared by the payments list and the overview's
// recent-payments card.
const PAYMENT_LOOKUP_STAGES: PipelineStage[] = [
  { $lookup: { from: 'users', localField: 'user', foreignField: '_id', as: 'merchant' } },
  { $unwind: { path: '$merchant', preserveNullAndEmptyArrays: true } },
  { $lookup: { from: 'payments', localField: '_id', foreignField: 'order', as: 'pay' } },
  { $unwind: { path: '$pay', preserveNullAndEmptyArrays: true } },
  { $lookup: { from: 'lifitransactions', localField: '_id', foreignField: 'order', as: 'lifi' } },
  { $unwind: { path: '$lifi', preserveNullAndEmptyArrays: true } },
  {
    $lookup: {
      from: 'donationlinks',
      localField: 'donation',
      foreignField: '_id',
      as: 'donationLink',
    },
  },
  { $unwind: { path: '$donationLink', preserveNullAndEmptyArrays: true } },
];

// Shape a hydrated order into the dashboard payment row. asset/network/crypto/
// payoutTx only surface once the payment has settled (status === completed).
const mapPaymentRow = (o: PaymentAggRow) => {
  const dashStatus = mapDashboardStatus(o.status);
  const completed = dashStatus === 'completed';
  const pay = o.pay;
  const lifi = o.lifi;

  return {
    id: o.id,
    merchantHandle: handle(o.merchant?.username) ?? handle(o.donationLink?.username),
    merchantId: o.merchant?._id?.toString() ?? null,
    asset: completed ? pay?.token ?? null : null,
    network: completed ? pay?.network ?? null : null,
    status: dashStatus,
    orderStatus: o.status,
    dateISO: new Date(o.createdAt).toISOString().slice(0, 10),
    date: formatDate(o.createdAt),
    usd: formatUsd(o.amount),
    amountUsd: Number(o.amount) || 0,
    crypto: completed && pay ? `${pay.detectedAmount} ${pay.token}` : null,
    payoutTx: completed ? lifi?.receivingTxHash ?? lifi?.sendingTxHash ?? null : null,
  };
};

// =========================================================================
// Auth
// =========================================================================

// POST /admin/login — exchange the two shared secrets for a JWT.
export const adminLogin = (req: Request, res: Response) => {
  if (!isAdminConfigured()) {
    return res.status(503).json({ success: false, message: 'Admin panel is not configured' });
  }

  const cfg = getAdminConfig();
  const { id, secret } = req.body ?? {};

  if (!id || !secret) {
    return res.status(400).json({ success: false, message: 'id and secret are required' });
  }

  // Both checks run (no short-circuit on the first) and use constant-time
  // comparison, so a wrong id can't be distinguished from a wrong secret by
  // timing.
  const idOk = safeEqual(String(id), cfg.id as string);
  const secretOk = safeEqual(String(secret), cfg.secret as string);

  if (!idOk || !secretOk) {
    return res.status(401).json({ success: false, message: 'Invalid credentials' });
  }

  const { token, exp } = signJwt({ sub: 'admin' }, cfg.jwtSecret as string, cfg.tokenTtlSec);

  return res.status(200).json({
    success: true,
    data: {
      token,
      tokenType: 'Bearer',
      expiresIn: cfg.tokenTtlSec,
      expiresAt: new Date(exp * 1000).toISOString(),
    },
  });
};

// GET /admin/me — cheap endpoint for the panel to confirm its token is valid.
export const adminMe = (req: Request, res: Response) => {
  return res.status(200).json({
    success: true,
    data: {
      authenticated: true,
      sub: req.admin?.sub,
      issuedAt: req.admin?.iat ? new Date(req.admin.iat * 1000).toISOString() : null,
      expiresAt: req.admin?.exp ? new Date(req.admin.exp * 1000).toISOString() : null,
    },
  });
};

// =========================================================================
// Overview
// =========================================================================

// GET /admin/overview — the aggregate KPIs + breakdowns for the landing page.
export const getOverview = async (_req: Request, res: Response) => {
  try {
    const serviceFee = getServiceFee().toNumber();

    const now = new Date();
    const todayStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );

    const [
      totals,
      pending,
      methods,
      topMerchants,
      statusCounts,
      totalMerchants,
      dailyPayments,
      newSignupsToday,
      recent,
    ] = await Promise.all([
      // Settled volume + count of successful payments.
      Order.aggregate([
        { $match: { status: FINISHED } },
        { $group: { _id: null, volume: { $sum: { $toDouble: '$amount' } }, count: { $sum: 1 } } },
      ]),
      // Money we owe merchants but haven't forwarded yet (payment detected,
      // settlement in flight or under review).
      Order.aggregate([
        { $match: { status: { $in: ['processing', 'manual_review'] } } },
        { $group: { _id: null, amount: { $sum: { $toDouble: '$amount' } }, count: { $sum: 1 } } },
      ]),
      // Volume split by the asset that was actually paid (from the linked
      // Payment), biggest first.
      Order.aggregate([
        { $match: { status: FINISHED } },
        { $lookup: { from: 'payments', localField: '_id', foreignField: 'order', as: 'pay' } },
        { $unwind: '$pay' },
        {
          $group: {
            _id: '$pay.token',
            amount: { $sum: { $toDouble: '$amount' } },
            count: { $sum: 1 },
          },
        },
        { $sort: { amount: -1 } },
      ]),
      // Top 5 merchants by settled volume.
      Order.aggregate([
        { $match: { status: FINISHED } },
        {
          $group: {
            _id: '$user',
            paidOut: { $sum: { $toDouble: '$amount' } },
            payments: { $sum: 1 },
          },
        },
        { $sort: { paidOut: -1 } },
        { $limit: 5 },
        { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'user' } },
        { $unwind: '$user' },
      ]),
      // One pass over all orders, grouped by raw status, for the success rate.
      Order.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
      User.countDocuments(),
      Order.countDocuments({ status: FINISHED, createdAt: { $gte: todayStart } }),
      User.countDocuments({ createdAt: { $gte: todayStart } }),
      // Most recent payments for the overview's "recent payments" card.
      Order.aggregate([
        ...PAYMENT_LOOKUP_STAGES,
        { $sort: { createdAt: -1, _id: -1 } },
        { $limit: 7 },
      ]),
    ]);

    const volume = totals[0]?.volume ?? 0;
    const finishedCount = totals[0]?.count ?? 0;

    const statusMap: Record<string, number> = {};
    for (const row of statusCounts) statusMap[row._id] = row.count;
    const failedCount = (statusMap.failed ?? 0) + (statusMap.expired ?? 0);
    const terminal = finishedCount + failedCount;
    const successRate = terminal > 0 ? Number(((finishedCount / terminal) * 100).toFixed(1)) : 0;

    const methodsTotal = methods.reduce((sum: number, m: { amount: number }) => sum + m.amount, 0);

    return res.status(200).json({
      success: true,
      data: {
        totalVolume: volume,
        revenue: Number((finishedCount * serviceFee).toFixed(2)),
        pendingPayouts: {
          amount: pending[0]?.amount ?? 0,
          queued: pending[0]?.count ?? 0,
        },
        dailyPayments,
        avgTransactionValue:
          finishedCount > 0 ? Number((volume / finishedCount).toFixed(2)) : 0,
        successRate,
        totalMerchants,
        newSignupsToday,
        paymentMethods: methods.map((m: { _id: string; amount: number; count: number }) => ({
          asset: m._id,
          amount: m.amount,
          count: m.count,
          pct: methodsTotal > 0 ? Number(((m.amount / methodsTotal) * 100).toFixed(1)) : 0,
        })),
        topMerchants: (topMerchants as TopMerchantAggRow[]).map((t) => ({
          merchantId: t._id?.toString() ?? null,
          name: t.user?.name ?? null,
          handle: handle(t.user?.username),
          payments: t.payments,
          paidOut: t.paidOut,
        })),
        recentPayments: (recent as PaymentAggRow[]).map(mapPaymentRow),
      },
    });
  } catch (error) {
    logger.error({ err: error }, 'Error building admin overview');

    return res.status(500).json({
      success: false,
      message: 'Error building overview',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

// =========================================================================
// Payments (orders)
// =========================================================================

// GET /admin/payments — paginated, filterable list of every order.
//
// Filters (all optional, AND-combined): asset, network, date (YYYY-MM-DD),
// status (completed|pending|failed or a raw order status), merchantId (a User
// _id for an exact match, or a username substring otherwise — "this is an
// important filter").
export const getPayments = async (req: Request, res: Response) => {
  try {
    const pagination = parsePagination(req);

    const asset = queryStr(req.query.asset).trim();
    const network = queryStr(req.query.network).trim();
    const date = queryStr(req.query.date).trim();
    const statusRaw = queryStr(req.query.status).trim().toLowerCase();
    const merchantId = queryStr(req.query.merchantId).trim();

    // --- pre-lookup match (uses Order indexes where possible) ---
    const preMatch: Record<string, unknown> = {};

    if (statusRaw && statusRaw !== 'any') {
      if (DASHBOARD_STATUS_GROUPS[statusRaw]) {
        preMatch.status = { $in: DASHBOARD_STATUS_GROUPS[statusRaw] };
      } else if (RAW_ORDER_STATUSES.includes(statusRaw)) {
        preMatch.status = statusRaw;
      }
    }

    if (date) {
      // Exact calendar-day match in UTC: [date 00:00, next day 00:00).
      const start = new Date(`${date}T00:00:00.000Z`);

      if (!Number.isNaN(start.getTime())) {
        const end = new Date(start);
        end.setUTCDate(end.getUTCDate() + 1);
        preMatch.createdAt = { $gte: start, $lt: end };
      }
    }

    // Merchant filter: exact user id when it looks like an ObjectId, otherwise a
    // case-insensitive username substring (applied after the user $lookup).
    let usernameRegex: RegExp | null = null;
    if (merchantId) {
      if (isValidObjectId(merchantId)) {
        preMatch.user = new Types.ObjectId(merchantId);
      } else {
        usernameRegex = new RegExp(escapeRegex(merchantId), 'i');
      }
    }

    // merchant.username (substring), asset, and network all live on looked-up
    // docs, so they filter after the lookups.
    const postMatch: Record<string, unknown> = {};
    if (usernameRegex) {
      postMatch['merchant.username'] = usernameRegex;
    }
    if (asset && asset !== 'any') {
      postMatch['pay.token'] = new RegExp(`^${escapeRegex(asset)}$`, 'i');
    }
    if (network && network !== 'any') {
      postMatch['pay.network'] = new RegExp(`^${escapeRegex(network)}$`, 'i');
    }

    const pipeline: PipelineStage[] = [{ $match: preMatch }, ...PAYMENT_LOOKUP_STAGES];

    if (Object.keys(postMatch).length) {
      pipeline.push({ $match: postMatch });
    }

    pipeline.push(
      { $sort: { createdAt: -1, _id: -1 } },
      {
        $facet: {
          data: [{ $skip: pagination.skip }, { $limit: pagination.limit }],
          meta: [{ $count: 'total' }],
        },
      },
    );

    const agg = await Order.aggregate(pipeline);
    const rows = (agg[0]?.data ?? []) as PaymentAggRow[];
    const total = agg[0]?.meta?.[0]?.total ?? 0;

    const data = rows.map(mapPaymentRow);

    return res.status(200).json({
      success: true,
      data,
      pagination: buildMeta(total, pagination),
    });
  } catch (error) {
    logger.error({ err: error }, 'Error listing admin payments');

    return res.status(500).json({
      success: false,
      message: 'Error fetching payments',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

// =========================================================================
// Merchants (users)
// =========================================================================

// GET /admin/merchants — paginated list of users, each with their settled
// payment count, total paid out, and the revenue (service fees) they generated.
export const getMerchants = async (req: Request, res: Response) => {
  try {
    const pagination = parsePagination(req);
    const serviceFee = getServiceFee().toNumber();

    const agg = await User.aggregate([
      {
        $lookup: {
          from: 'orders',
          let: { uid: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: { $and: [{ $eq: ['$user', '$$uid'] }, { $eq: ['$status', FINISHED] }] },
              },
            },
            {
              $group: {
                _id: null,
                paidOut: { $sum: { $toDouble: '$amount' } },
                payments: { $sum: 1 },
              },
            },
          ],
          as: 'stats',
        },
      },
      {
        $lookup: {
          from: 'donationlinks',
          let: { uid: '$_id' },
          pipeline: [
            { $match: { $expr: { $eq: ['$user', '$$uid'] } } },
            { $sort: { createdAt: 1 } },
            { $limit: 1 },
            { $project: { username: 1 } },
          ],
          as: 'dl',
        },
      },
      {
        $addFields: {
          payments: { $ifNull: [{ $arrayElemAt: ['$stats.payments', 0] }, 0] },
          paidOut: { $ifNull: [{ $arrayElemAt: ['$stats.paidOut', 0] }, 0] },
          donationUsername: { $arrayElemAt: ['$dl.username', 0] },
        },
      },
      { $sort: { paidOut: -1, _id: 1 } },
      {
        $facet: {
          data: [{ $skip: pagination.skip }, { $limit: pagination.limit }],
          meta: [{ $count: 'total' }],
        },
      },
    ]);

    const rows = (agg[0]?.data ?? []) as MerchantAggRow[];
    const total = agg[0]?.meta?.[0]?.total ?? 0;

    const data = rows.map((u) => ({
      name: u.name ?? null,
      id: u._id.toString(),
      username: handle(u.username),
      donationUsername: handle(u.donationUsername),
      payments: u.payments,
      paidOut: u.paidOut,
      revenue: Number((u.payments * serviceFee).toFixed(2)),
    }));

    return res.status(200).json({
      success: true,
      data,
      pagination: buildMeta(total, pagination),
    });
  } catch (error) {
    logger.error({ err: error }, 'Error listing admin merchants');

    return res.status(500).json({
      success: false,
      message: 'Error fetching merchants',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

// =========================================================================
// Donatees (donation links)
// =========================================================================

// GET /admin/donatees — paginated list of donation links, each with the count
// and total of donations raised through it, plus the owner's telegram handle.
export const getDonatees = async (req: Request, res: Response) => {
  try {
    const pagination = parsePagination(req);

    const agg = await DonationLink.aggregate([
      {
        $lookup: {
          from: 'orders',
          let: { did: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: { $and: [{ $eq: ['$donation', '$$did'] }, { $eq: ['$status', FINISHED] }] },
              },
            },
            {
              $group: {
                _id: null,
                raised: { $sum: { $toDouble: '$amount' } },
                donations: { $sum: 1 },
              },
            },
          ],
          as: 'stats',
        },
      },
      { $lookup: { from: 'users', localField: 'user', foreignField: '_id', as: 'owner' } },
      { $unwind: { path: '$owner', preserveNullAndEmptyArrays: true } },
      {
        $addFields: {
          donations: { $ifNull: [{ $arrayElemAt: ['$stats.donations', 0] }, 0] },
          raised: { $ifNull: [{ $arrayElemAt: ['$stats.raised', 0] }, 0] },
        },
      },
      { $sort: { raised: -1, _id: 1 } },
      {
        $facet: {
          data: [{ $skip: pagination.skip }, { $limit: pagination.limit }],
          meta: [{ $count: 'total' }],
        },
      },
    ]);

    const rows = (agg[0]?.data ?? []) as DonateeAggRow[];
    const total = agg[0]?.meta?.[0]?.total ?? 0;

    const data = rows.map((d) => ({
      donationUsername: handle(d.username),
      donations: d.donations,
      raised: d.raised,
      telegram: handle(d.owner?.username),
    }));

    return res.status(200).json({
      success: true,
      data,
      pagination: buildMeta(total, pagination),
    });
  } catch (error) {
    logger.error({ err: error }, 'Error listing admin donatees');

    return res.status(500).json({
      success: false,
      message: 'Error fetching donatees',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

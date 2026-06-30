import { Request, Response } from 'express';

import { Order, IOrder } from '../models/Order';
import { Receipt } from '../models/Receipt';
import { logger } from '../configs/logger';
import { IPayment, Payment } from '../models/Payment';
import { sendMail, isMailerConfigured } from '../configs/mailer';

// --- email validation -----------------------------------------------------
const MAX_EMAIL_LEN = 254; // RFC 5321 practical upper bound
// Pragmatic "looks like an email" check: one @, no spaces, a dot in the domain.
// We deliberately don't try to fully validate per RFC — the only real proof an
// address works is that the email arrives.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// req.body values can be anything (string | string[] | object | undefined);
// normalise to a trimmed, lowercased string.
const normalizeEmail = (raw: unknown): string => {
  const v = Array.isArray(raw) ? raw[0] : raw;

  return typeof v === 'string' ? v.trim().toLowerCase() : '';
};

const isValidEmail = (email: string): boolean =>
  email.length > 0 && email.length <= MAX_EMAIL_LEN && EMAIL_RE.test(email);

// A mongo duplicate-key error (E11000) — here, the unique `orderId` index on the
// Receipt collection rejecting a second receipt request for the same order.
const isDuplicateKeyError = (err: unknown): boolean =>
  typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;

// --- receipt content ------------------------------------------------------
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// "Jun 18, 2026"
const formatDate = (d: Date | string): string => {
  const dt = new Date(d);

  return `${MONTHS[dt.getUTCMonth()]} ${dt.getUTCDate()}, ${dt.getUTCFullYear()}`;
};

// "$1,003.00" — manual grouping so we don't depend on the runtime's ICU build
// (matches the admin dashboard's formatter).
const formatUsd = (value: number | string): string => {
  const num = Number(value) || 0;
  const [intPart, decPart] = num.toFixed(2).split('.');

  return `$${intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${decPart}`;
};

const escapeHtml = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

interface ReceiptEmail {
  subject: string;
  text: string;
  html: string;
}

// Build the plain-text + HTML receipt from the order and (when settled) its
// linked payment. Only payer-safe facts are included — never the private key,
// the merchant payout destination, or the owning user.
const buildReceiptEmail = (order: IOrder, payment: IPayment | null): ReceiptEmail => {
  const amountUsd = formatUsd(order.amount);
  const dateStr = formatDate(order.paidAt ?? order.createdAt);
  const paidWith = payment ? `${payment.detectedAmount} ${payment.token} on ${payment.network}` : null;
  const txHash = payment?.sweepTxHash;
  const note = order.text?.trim();

  // --- plain text ---
  const textLines = [
    'Payment receipt',
    '',
    `Order:   ${order.id}`,
    `Amount:  ${amountUsd}`,
    `Date:    ${dateStr}`,
    `Status:  Paid`,
  ];
  if (paidWith) textLines.push(`Paid:    ${paidWith}`);
  if (txHash) textLines.push(`Tx:      ${txHash}`);
  if (note) textLines.push('', `Your note: ${note}`);
  textLines.push('', 'Thank you for your payment.');
  const text = textLines.join('\n');

  // --- html ---
  const row = (label: string, value: string) =>
    `<tr>
      <td style="padding:6px 0;color:#6b7280;font-size:14px;">${label}</td>
      <td style="padding:6px 0;color:#111827;font-size:14px;font-weight:600;text-align:right;">${value}</td>
    </tr>`;

  const rows = [
    row('Order', escapeHtml(order.id)),
    row('Amount', amountUsd),
    row('Date', dateStr),
    row('Status', 'Paid'),
  ];
  if (paidWith) rows.push(row('Paid with', escapeHtml(paidWith)));
  if (txHash) {
    rows.push(
      row(
        'Transaction',
        `<span style="font-family:monospace;font-size:12px;word-break:break-all;">${escapeHtml(txHash)}</span>`,
      ),
    );
  }

  const noteBlock = note
    ? `<p style="margin:16px 0 0;padding:12px;background:#f9fafb;border-radius:8px;color:#374151;font-size:14px;">
        <strong>Your note:</strong> ${escapeHtml(note)}
      </p>`
    : '';

  const html = `<!doctype html>
<html>
  <body style="margin:0;background:#f3f4f6;padding:24px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;background:#ffffff;border-radius:12px;padding:32px;">
            <tr>
              <td>
                <h1 style="margin:0 0 4px;font-size:20px;color:#111827;">Payment receipt</h1>
                <p style="margin:0 0 24px;color:#6b7280;font-size:14px;">Thank you for your payment.</p>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  ${rows.join('\n')}
                </table>
                ${noteBlock}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject: `Your receipt for order ${order.id}`, text, html };
};

// =========================================================================
// POST /orders/:id/receipt
// =========================================================================
//
// Emails a one-time receipt for a *finished* order to an address the payer
// supplies in the gateway's "send the receipt to your email?" box. The email is
// sent out of band, so the caller gets an immediate 202 and never waits on SMTP.
export const requestOrderReceipt = async (req: Request, res: Response) => {
  try {
    // Email is a secondary subsystem: when SMTP is unconfigured the feature is
    // simply unavailable (503), exactly like the admin panel — the rest of the
    // API is unaffected.
    if (!isMailerConfigured()) {
      return res
        .status(503)
        .json({ success: false, message: 'Email receipts are not available right now' });
    }

    const email = normalizeEmail(req.body?.email);

    if (!isValidEmail(email)) {
      return res.status(400).json({ success: false, message: 'A valid email is required' });
    }

    const order = await Order.findOne({ id: req.params.id });

    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    // The receipt box is only offered once the payment has completed.
    if (order.status !== 'finished') {
      return res.status(409).json({ success: false, message: 'Order is not finished yet' });
    }

    // Claim the one-time slot. The unique `orderId` index is the single point
    // that enforces "one receipt per order": a second request hits a duplicate
    // key and is rejected here, so nobody can fire a thousand emails at an order.
    const receipt = await Receipt.create({ orderId: order.id, order: order._id, email }).catch(
      (err: unknown) => {
        if (isDuplicateKeyError(err)) return null;

        throw err;
      },
    );

    if (!receipt) {
      return res.status(409).json({
        success: false,
        message: 'A receipt has already been requested for this order',
      });
    }

    // Respond immediately — the caller does not wait for the email to be sent.
    res.status(202).json({
      success: true,
      message: 'Your receipt is on its way.',
      data: { email },
    });

    // Fire-and-forget: build + send out of band. The async IIFE owns its errors
    // so a send failure can never reject into the request pipeline (the response
    // has already gone out). On failure we release the slot so the donor can try
    // again — the one-time rule guards against spamming a *successful* receipt,
    // not against a retry after a transient SMTP error.
    void (async () => {
      try {
        const payment = await Payment.findOne({ order: order._id }).lean<IPayment>();
        const { subject, text, html } = buildReceiptEmail(order, payment);

        await sendMail({ to: email, subject, text, html });
        await Receipt.updateOne({ _id: receipt._id }, { $set: { sentAt: new Date() } });

        logger.info({ orderId: order.id }, 'Receipt email sent');
      } catch (err) {
        logger.error({ err, orderId: order.id }, 'Failed to send receipt email; releasing slot');

        await Receipt.deleteOne({ _id: receipt._id }).catch(() => undefined);
      }
    })();
  } catch (error) {
    logger.error({ err: error }, 'Error requesting order receipt');

    return res.status(500).json({
      success: false,
      message: 'Failed to request receipt',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

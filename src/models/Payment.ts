import { Schema, model, Types } from 'mongoose';

export type PaymentStatus =
  | 'detected' // balance seen, waiting for confirmations
  | 'confirming' // finality not yet reached
  | 'settling' // sweep UserOp in flight
  | 'settled' // funds delivered to merchant + treasury
  | 'failed' // settlement failed, may retry
  | 'manual_review'; // needs a human (e.g. parity mismatch, cannot cover amount)

export interface IPayment {
  orderId: string;
  order: Types.ObjectId;
  network: string;
  chainId: number;
  token: string; // ETH | USDC | USDT
  tokenAddress?: string;
  smartAccount: string;

  detectedAmount: string; // display (4dp)
  detectedAmountRaw: string; // smallest units
  expectedTotal: string; // order pricing total for this network/token
  expectedAmount: string; // merchant core amount (paid-token units)
  merchantTargetUsd?: string;

  detectedAtBlock: number;
  confirmations: number;
  attempts: number;

  status: PaymentStatus;

  // Settlement results
  userOpHash?: string;
  sweepTxHash?: string;
  merchantAmountRaw?: string; // input routed toward the merchant
  treasuryAmount?: string; // leftover sent to treasury (display)
  treasuryAmountRaw?: string;
  error?: string;
}

const PaymentSchema = new Schema<IPayment>(
  {
    orderId: { type: String, required: true, unique: true, index: true },
    order: { type: Schema.Types.ObjectId, ref: 'Order', required: true },
    network: { type: String, required: true },
    chainId: { type: Number, required: true },
    token: { type: String, required: true },
    tokenAddress: { type: String },
    smartAccount: { type: String, required: true },

    detectedAmount: { type: String, required: true },
    detectedAmountRaw: { type: String, required: true },
    expectedTotal: { type: String, required: true },
    expectedAmount: { type: String, required: true },
    merchantTargetUsd: { type: String },

    detectedAtBlock: { type: Number, required: true },
    confirmations: { type: Number, default: 0 },
    attempts: { type: Number, default: 0 },

    status: {
      type: String,
      required: true,
      enum: ['detected', 'confirming', 'settling', 'settled', 'failed', 'manual_review'],
      default: 'detected',
    },

    userOpHash: { type: String },
    sweepTxHash: { type: String },
    merchantAmountRaw: { type: String },
    treasuryAmount: { type: String },
    treasuryAmountRaw: { type: String },
    error: { type: String },
  },
  { timestamps: true },
);

export const Payment = model<IPayment>('Payment', PaymentSchema);

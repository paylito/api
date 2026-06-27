import { Schema, model, Types } from 'mongoose';

/**
 * Audit record for every LI.FI route we execute on a payer's behalf. Kept
 * separately from Payment so we retain the full quote + status history for
 * reconciliation even if a route ends up PARTIAL or REFUNDED.
 */
export interface ILifiTransaction {
  orderId: string;
  order: Types.ObjectId;
  payment: Types.ObjectId;

  fromChainId: number;
  toChainId: number;
  fromToken: string;
  toToken: string;
  fromAddress: string; // smart account (sender)
  toAddress: string; // merchant (recipient)

  fromAmountRaw: string;
  toAmountRaw: string; // estimated received
  toAmountMinRaw: string; // guaranteed floor after slippage
  tool?: string;
  integrator?: string;

  // Populated from GET /v1/status
  lifiTransactionId?: string; // LI.FI stable transfer id (not a tx hash)
  sendingTxHash?: string;
  receivingTxHash?: string;
  status?: string; // NOT_FOUND | PENDING | DONE | FAILED
  substatus?: string; // COMPLETED | PARTIAL | REFUNDED | ...
  substatusMessage?: string;

  quote?: unknown; // raw quote response (audit)
  statusRaw?: unknown; // last raw /status response (audit)
}

const LifiTransactionSchema = new Schema<ILifiTransaction>(
  {
    orderId: { type: String, required: true, index: true },
    order: { type: Schema.Types.ObjectId, ref: 'Order', required: true },
    payment: { type: Schema.Types.ObjectId, ref: 'Payment', required: true },

    fromChainId: { type: Number, required: true },
    toChainId: { type: Number, required: true },
    fromToken: { type: String, required: true },
    toToken: { type: String, required: true },
    fromAddress: { type: String, required: true },
    toAddress: { type: String, required: true },

    fromAmountRaw: { type: String, required: true },
    toAmountRaw: { type: String, required: true },
    toAmountMinRaw: { type: String, required: true },
    tool: { type: String },
    integrator: { type: String },

    lifiTransactionId: { type: String },
    sendingTxHash: { type: String },
    receivingTxHash: { type: String },
    status: { type: String },
    substatus: { type: String },
    substatusMessage: { type: String },

    quote: { type: Schema.Types.Mixed },
    statusRaw: { type: Schema.Types.Mixed },
  },
  { timestamps: true },
);

export const LifiTransaction = model<ILifiTransaction>('LifiTransaction', LifiTransactionSchema);

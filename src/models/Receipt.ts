import { Schema, model, Types } from 'mongoose';

// A donor-requested emailed receipt for a finished order. Created when a payer
// asks (once) for the receipt to be sent to their email from the payment-gateway
// "receipt to your email?" box after the order completes.
//
// `orderId` is unique: that index is what makes the request a one-time action
// per order — a second submission for the same order hits a duplicate-key error
// instead of firing another email. `sentAt` is stamped once the email actually
// goes out (the send is fire-and-forget, so it lags the record's creation).
export interface IReceipt {
  orderId: string; // public short order id (Order.id)
  order: Types.ObjectId; // the order this receipt is for
  email: string; // address the receipt is sent to
  sentAt?: Date; // when the email was dispatched (unset until it sends)
}

const ReceiptSchema = new Schema<IReceipt>(
  {
    orderId: { type: String, required: true, unique: true, index: true },
    order: { type: Schema.Types.ObjectId, ref: 'Order', required: true },
    email: { type: String, required: true, trim: true, lowercase: true },
    sentAt: { type: Date },
  },
  { timestamps: true },
);

export const Receipt = model<IReceipt>('Receipt', ReceiptSchema);

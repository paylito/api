import { Schema, model } from 'mongoose';

interface IOrderTokenPricing {
  symbol: string;
  priceUsd: string;
  amountUsd: string;
  amount: string;
  serviceFeeUsd: string;
  serviceFee: string;
  networkFeeUsd: string;
  networkFee: string;
  totalUsd: string;
  total: string;
}

interface IOrderNetworkPricing {
  network: string;
  networkFeeUsd: string;
  tokens: IOrderTokenPricing[];
}

export type IOrderPricing = IOrderNetworkPricing[];

export interface IOrder {
  id: string;
  amount: string;
  createdAt: Date;
  privateKey: string;
  evmAddress: string;
  tronAddress: string;
  smartAccount: string;
  solanaAddress: string;
  stellarAddress: string;
  destinationToken: string;
  destinationNetwork: string;
  destinationAddress: string;
  bitcoinLegacyAddress: string;
  bitcoinSegwitAddress: string;
  user: Schema.Types.ObjectId;
  rates: Schema.Types.ObjectId;
  status: 'pending' | 'processing' | 'finished' | 'expired' | 'failed' | 'manual_review';
  expiresAt: Date;
  pricing: IOrderPricing;
  receiptChatId?: string;
  receiptMessageId?: number;
  paidAt?: Date;
  payment?: Schema.Types.ObjectId;
}

const OrderSchema = new Schema<IOrder>(
  {
    amount: { type: String, required: true },
    status: { type: String, required: true },
    createdAt: { type: Date, required: true },
    privateKey: { type: String, required: true },
    smartAccount: { type: String, required: true },
    id: { type: String, required: true, unique: true },
    evmAddress: { type: String, required: true },
    tronAddress: { type: String, required: true },
    solanaAddress: { type: String, required: true },
    stellarAddress: { type: String, required: true },
    bitcoinLegacyAddress: { type: String, required: true },
    bitcoinSegwitAddress: { type: String, required: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    rates: { type: Schema.Types.ObjectId, ref: 'Rates', required: true },
    destinationToken: { type: String, required: true },
    destinationNetwork: { type: String, required: true },
    destinationAddress: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    paidAt: { type: Date },
    payment: { type: Schema.Types.ObjectId, ref: 'Payment' },
    pricing: {
      type: [
        {
          network: { type: String, required: true },
          networkFeeUsd: { type: String, required: true },
          tokens: [
            {
              symbol: { type: String, required: true },
              priceUsd: { type: String, required: true },
              amountUsd: { type: String, required: true },
              amount: { type: String, required: true },
              serviceFeeUsd: { type: String, required: true },
              serviceFee: { type: String, required: true },
              networkFeeUsd: { type: String, required: true },
              networkFee: { type: String, required: true },
              totalUsd: { type: String, required: true },
              total: { type: String, required: true },
            },
          ],
        },
      ],
      required: true,
    },
    receiptChatId: { type: String },
    receiptMessageId: { type: Number },
  },
  { timestamps: true },
);

export const Order = model<IOrder>('Order', OrderSchema);

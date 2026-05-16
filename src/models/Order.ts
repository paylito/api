import { Schema, model } from 'mongoose';

interface IOrder {
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
  status: 'pending' | 'finished' | 'expired';
  expiresAt: Date;
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
  },
  { timestamps: true },
);

export const Order = model<IOrder>('Order', OrderSchema);

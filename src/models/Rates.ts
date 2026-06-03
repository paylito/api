import { Schema, model } from 'mongoose';

export interface IRates {
  BTC: number;
  ETH: number;
  BNB: number;
  XLM: number;
  TRX: number;
  USDC: number;
  SOL: number;
  CELO: number;
  POL: number;
  USDT: number;
  createdAt: Date;
  updatedAt: Date;
}

const RatesSchema = new Schema<IRates>(
  {
    BTC: { type: Number, required: true },
    ETH: { type: Number, required: true },
    BNB: { type: Number, required: true },
    XLM: { type: Number, required: true },
    TRX: { type: Number, required: true },
    USDC: { type: Number, required: true },
    SOL: { type: Number, required: true },
    CELO: { type: Number, required: true },
    POL: { type: Number, required: true },
    USDT: { type: Number, required: true },
  },
  { timestamps: true },
);

export const Rates = model<IRates>('Rates', RatesSchema);

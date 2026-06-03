import { Schema, model } from 'mongoose';

export interface IFeeConfig {
  network: string;
  minFee: number;
  isVariable: boolean;
  lastUpdated: Date;
}

const FeeConfigSchema = new Schema<IFeeConfig>({
  network: { type: String, required: true, unique: true },
  minFee: { type: Number, required: true },
  isVariable: { type: Boolean, required: true },
  lastUpdated: { type: Date, default: Date.now },
});

export const FeeConfig = model<IFeeConfig>('FeeConfig', FeeConfigSchema);

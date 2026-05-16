import { Schema, model } from 'mongoose';

interface IUser {
  chatId: string;
  destinationToken: string;
  destinationNetwork: string;
  destinationAddress: string;
}

const UserSchema = new Schema<IUser>(
  {
    chatId: { type: String, required: true, unique: true },
    destinationNetwork: { type: String },
    destinationAddress: { type: String },
    destinationToken: { type: String },
  },
  { timestamps: true },
);

export const User = model<IUser>('User', UserSchema);

import { Schema, model } from 'mongoose';

export interface IUserProfile {
  preferredLanguage: string;
  communicationStyle?: string;
  humorTolerance: number;
  interests: string[];
  emotionalPatterns?: string;
  preferences?: Record<string, string>;
}

export interface IUser {
  name?: string;
  username?: string;
  chatId: string;
  destinationToken?: string;
  destinationNetwork?: string;
  destinationAddress?: string;
  is_waitlist: boolean;
  profile: IUserProfile;
  createdAt: Date;
  updatedAt: Date;
}

const UserProfileSchema = new Schema<IUserProfile>({
  preferredLanguage: { type: String, default: 'en' },
  communicationStyle: { type: String },
  humorTolerance: { type: Number, default: 0.7 },
  interests: { type: [String], default: [] },
  emotionalPatterns: { type: String },
  preferences: { type: Schema.Types.Mixed },
});

const UserSchema = new Schema<IUser>(
  {
    name: { type: String },
    username: { type: String },
    chatId: { type: String, required: true, unique: true },
    destinationToken: { type: String },
    destinationNetwork: { type: String },
    destinationAddress: { type: String },
    is_waitlist: { type: Boolean, default: false },
    profile: { type: UserProfileSchema, default: () => ({}) },
  },
  { timestamps: true },
);

export const User = model<IUser>('User', UserSchema);

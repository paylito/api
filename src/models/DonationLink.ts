import { Schema, model } from 'mongoose';

export interface IDonationLink {
  username: string;
  user: Schema.Types.ObjectId;
  destinationToken: string;
  destinationNetwork: string;
  destinationAddress: string;
  custom: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const DonationLinkSchema = new Schema<IDonationLink>(
  {
    // Public handle in the donation URL (donate.payli.to/<username>). Always
    // stored lowercase and globally unique across every user in the project.
    username: { type: String, required: true, unique: true, lowercase: true, trim: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    // Destination is snapshotted at creation time (just like an order): the
    // donation page always pays out to exactly what was set when the link was
    // made, whether that was the user's saved default or a one-off custom
    // destination. An order created later from this link copies these fields.
    destinationToken: { type: String, required: true },
    destinationNetwork: { type: String, required: true },
    destinationAddress: { type: String, required: true },
    // True when the link was created with a one-off custom destination rather
    // than the user's saved default.
    custom: { type: Boolean, default: false },
  },
  { timestamps: true },
);

export const DonationLink = model<IDonationLink>('DonationLink', DonationLinkSchema);

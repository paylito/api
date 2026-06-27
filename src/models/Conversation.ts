import { Schema, model } from 'mongoose';

export interface IConversation {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  user: Schema.Types.ObjectId;
}

const ConversationSchema = new Schema<IConversation>(
  {
    role: {
      type: String,
      required: true,
      enum: ['user', 'assistant', 'system'],
    },
    content: { type: String, required: true },
    timestamp: { type: Date, default: Date.now },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  {
    timestamps: true,
  },
);

export const Conversation = model<IConversation>('Conversation', ConversationSchema);

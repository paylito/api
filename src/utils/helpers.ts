import { randomBytes } from 'crypto';

export const createShortId = () => {
  return randomBytes(5).toString('hex');
};

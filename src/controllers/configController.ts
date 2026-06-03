import { Request, Response } from 'express';

import { NETWORKS, TOKENS } from '../utils/tokens';

export const getConfig = (_req: Request, res: Response) => {
  res.status(200).json({
    networks: Object.values(NETWORKS),
    tokens: Object.values(TOKENS),
  });
};

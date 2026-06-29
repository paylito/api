import { Request, Response } from 'express';

import { logger } from '../configs/logger';
import { NETWORKS, TOKENS } from '../utils/tokens';

export const getConfig = (_req: Request, res: Response) => {
  try {
    res.status(200).json({
      networks: Object.values(NETWORKS),
      tokens: Object.values(TOKENS),
    });
  } catch (error) {
    logger.error({ err: error }, 'Error building config response');

    res.status(500).json({
      success: false,
      message: 'Error fetching config',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

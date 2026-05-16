import { connect } from 'mongoose';

import { logger } from './logger';

export const db = async (url: string, dbName: string) => {
  try {
    await connect(url, { dbName });

    logger.info('DB: Connected');
  } catch (e) {
    logger.fatal(`DB: Failed to connect to ${url}/${dbName}`);

    process.exit(1);
  }
};

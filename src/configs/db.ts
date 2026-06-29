import mongoose, { connect } from 'mongoose';

import { logger } from './logger';
import { fatalExit } from './safety';

// Attach listeners on the shared connection up front. A connection 'error' event
// with no listener is an unhandled EventEmitter error → it would crash the whole
// process. mongoose auto-reconnects, so after startup we just log and ride it out
// instead of going down every time the database blips.
mongoose.connection.on('error', (err) => {
  logger.error({ err }, 'DB: connection error');
});
mongoose.connection.on('disconnected', () => {
  logger.warn('DB: disconnected');
});
mongoose.connection.on('reconnected', () => {
  logger.info('DB: reconnected');
});

export const db = async (url: string, dbName: string) => {
  try {
    await connect(url, { dbName });

    logger.info('DB: Connected');
  } catch (e) {
    // We can't run without a database: log FATAL (lands in the fatal log) and let
    // docker restart us — it will keep retrying until mongo is reachable.
    logger.fatal({ err: e }, `DB: failed to connect to ${url}/${dbName} — restarting process`);

    fatalExit(1);

    // Stop main() from continuing on to listen with no database behind it.
    throw e;
  }
};

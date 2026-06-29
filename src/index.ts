import cors from 'cors';
import swaggerUi from 'swagger-ui-express';
import express, { Express, Request, Response, NextFunction } from 'express';

import './models';
import { db } from './configs/db';
import { envs } from './configs/envs';
import { logger } from './configs/logger';
import { openApiDocument } from './configs/swagger';
import configRoutes from './routes/configRoutes';
import orderRoutes from './routes/orderRoutes';
import donationRoutes from './routes/donationRoutes';
import {
  fatalExit,
  isExiting,
  installCrashHandlers,
  installShutdownHandlers,
} from './configs/safety';

// Arm the process-wide safety net before anything else runs, so a throw from an
// async callback / timer / stream (which no try/catch can reach) is logged as
// FATAL and triggers a clean docker restart instead of a silent crash.
installCrashHandlers();

const { PORT, DB_URI, DB_NAME } = envs();

const app: Express = express();

const FINAL_PORT = PORT || 5000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const main = async () => {
  logger.info('App started');

  await db(DB_URI, DB_NAME);

  app.use('/orders', orderRoutes);
  app.use('/config', configRoutes);
  app.use('/donations', donationRoutes);

  // API documentation: interactive Swagger UI at /swagger and the raw OpenAPI
  // document at /swagger.json (for Postman/Insomnia imports and client codegen).
  app.get('/swagger.json', (_req: Request, res: Response) => {
    res.json(openApiDocument);
  });
  app.use(
    '/swagger',
    swaggerUi.serve,
    swaggerUi.setup(openApiDocument, {
      customSiteTitle: 'Payli API Docs',
      swaggerOptions: { persistAuthorization: true },
    }),
  );

  // Convenience: send the bare root to the docs.
  app.get('/', (_req: Request, res: Response) => {
    res.redirect('/swagger');
  });

  app.get('/health', (_req: Request, res: Response) => {
    res.status(200).json({ status: 'OK', message: 'Server is running' });
  });

  app.use((_req: Request, res: Response) => {
    res.status(404).json({ message: 'Route not found' });
  });

  // Express 5 forwards rejected async handlers here automatically, so this is the
  // single catch-all for request-level errors. We log and respond 500 — a bad
  // request must never take the whole server down.
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    logger.error({ err }, 'Unhandled error in request pipeline');

    // If the response already started streaming we can't set a new status —
    // attempting to would itself throw. Just stop here.
    if (res.headersSent) return;

    res.status(500).json({ message: 'Something went wrong!', error: err.message });
  });

  const server = app.listen(FINAL_PORT, () => {
    logger.info(`Server is running on port ${FINAL_PORT}`);
  });

  // A listen failure (e.g. EADDRINUSE) arrives as an 'error' event, not a throw;
  // without this handler it would surface as an uncaughtException.
  server.on('error', (err) => {
    logger.fatal({ err }, 'HTTP server error — restarting process');
    fatalExit(1);
  });

  installShutdownHandlers(server);
};

main().catch((err) => {
  // db() and other startup failures already log FATAL + schedule the exit; only
  // log here if something else slipped through, to avoid duplicate fatal records.
  if (!isExiting()) {
    logger.fatal({ err }, 'Fatal error during startup — restarting process');
    fatalExit(1);
  }
});

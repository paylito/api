import cors from 'cors';
import express, { Express, Request, Response, NextFunction } from 'express';

import './models';
import { db } from './configs/db';
import { envs } from './configs/envs';
import { logger } from './configs/logger';
import orderRoutes from './routes/orderRoutes';
import donationRoutes from './routes/donationRoutes';

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
  app.use('/donations', donationRoutes);

  app.get('/health', (_req: Request, res: Response) => {
    res.status(200).json({ status: 'OK', message: 'Server is running' });
  });

  app.use((_req: Request, res: Response) => {
    res.status(404).json({ message: 'Route not found' });
  });

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    logger.error(err.stack);

    res.status(500).json({ message: 'Something went wrong!', error: err.message });
  });

  app.listen(FINAL_PORT, () => {
    logger.info(`Server is running on port ${PORT}`);
  });
};

main();

/*
 * TODO:
 */

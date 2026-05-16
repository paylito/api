import bunyan from 'bunyan';

import { envs } from './envs';

const { LOG_FILE_PATH } = envs();

const streams: bunyan.Stream[] = [
  {
    level: bunyan.TRACE,
    stream: process.stdout,
  },
];

if (process.env.NODE_ENV == 'production') {
  streams.push({
    level: bunyan.TRACE,
    path: LOG_FILE_PATH,
  });
}

export const logger = bunyan.createLogger({
  name: 'telegram-notifier-bot',
  level: bunyan.TRACE,
  src: true,
  streams,
});

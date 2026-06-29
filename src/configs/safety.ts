import type { Server } from 'http';

import mongoose from 'mongoose';

import { logger } from './logger';

// Flipped the moment we decide to tear the process down, so the different exit
// paths (crash handler, startup failure, OS signal) don't fight each other.
let shuttingDown = false;

export const isExiting = () => shuttingDown;

// bunyan's file streams flush asynchronously, so a bare `process.exit()` right
// after `logger.fatal()` can drop the very record we care about. Give it a beat
// to reach disk, then exit non-zero so docker's restart policy recycles us.
export const fatalExit = (code = 1) => {
  if (shuttingDown) return;
  shuttingDown = true;

  setTimeout(() => process.exit(code), 500);
};

// The real fix for "it just randomly crashes": these two events fire from places
// no try/catch can reach — async callbacks, timers, EventEmitter 'error' events.
// Without a listener Node prints the error and dies; with one we log it as FATAL
// (so it lands in the dedicated fatal log) and exit cleanly for docker to restart.
export const installCrashHandlers = () => {
  process.on('uncaughtException', (err, origin) => {
    logger.fatal({ err, origin }, 'uncaughtException — restarting process');
    fatalExit(1);
  });

  process.on('unhandledRejection', (reason) => {
    const err =
      reason instanceof Error ? reason : new Error(`Non-error rejection: ${String(reason)}`);
    logger.fatal({ err }, 'unhandledRejection — restarting process');
    fatalExit(1);
  });
};

// Clean shutdown on `docker stop` (SIGTERM) and Ctrl-C (SIGINT): stop accepting
// new connections, close the DB, then exit 0. A 10s watchdog forces the exit if
// a connection is wedged so we never hang.
export const installShutdownHandlers = (server: Server) => {
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.info(`Received ${signal} — shutting down gracefully`);

    server.close(() => {
      mongoose.connection.close(false).finally(() => process.exit(0));
    });

    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
};

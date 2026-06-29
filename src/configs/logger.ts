import fs from 'fs';
import path from 'path';

import bunyan from 'bunyan';

// Imported for its side effect only: loading the env config runs dotenv, so
// process.env.LOG_FILE_PATH is populated (from .env locally, or from the real
// container environment under docker) before we read it just below.
import './envs';

const LOG_FILE_PATH = process.env.LOG_FILE_PATH;

// Always log to stdout — docker captures this in `docker logs`.
const streams: bunyan.Stream[] = [
  {
    level: bunyan.TRACE,
    stream: process.stdout,
  },
];

// Derive the FATAL-only log path from LOG_FILE_PATH, e.g.
//   /app/storage/app.log  ->  /app/storage/app.fatal.log
// so every crash is a single `cat app.fatal.log` away instead of being buried
// in the full firehose log.
const deriveFatalPath = (p: string) => {
  const ext = path.extname(p);
  return ext ? `${p.slice(0, -ext.length)}.fatal${ext}` : `${p}.fatal`;
};

// File logging turns on purely by the presence of LOG_FILE_PATH (docker sets it;
// local dev usually doesn't). Setting up logging must never be the thing that
// crashes the app, so this whole block is defensive: on any failure we log to
// stderr once and carry on with stdout only.
if (LOG_FILE_PATH) {
  try {
    fs.mkdirSync(path.dirname(LOG_FILE_PATH), { recursive: true });

    // Everything (TRACE and up) -> main log file.
    streams.push({ level: bunyan.TRACE, path: LOG_FILE_PATH });

    // FATAL only -> dedicated crash file you can watch on its own.
    streams.push({ level: bunyan.FATAL, path: deriveFatalPath(LOG_FILE_PATH) });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('logger: could not open log files, falling back to stdout only:', err);
  }
}

export const logger = bunyan.createLogger({
  name: 'payli-api',
  level: bunyan.TRACE,
  // `src: true` captures the call site but is expensive — keep it for local
  // debugging and drop it in production.
  src: process.env.NODE_ENV !== 'production',
  // Without this, an Error logged as `{ err }` serializes to `{}` (its message
  // and stack are non-enumerable). This is what makes `logger.fatal({ err }, …)`
  // actually record the message + stack trace we need to debug a crash.
  serializers: { err: bunyan.stdSerializers.err },
  streams,
});

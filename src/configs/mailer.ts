/**
 * Outbound email (SMTP) configuration.
 *
 * Like the admin secrets, these are read straight from `process.env` rather than
 * through `envs()`. That is deliberate: `envil` calls `process.exit(1)` if any
 * listed variable is missing, and email is a *secondary* subsystem — a missing
 * SMTP secret must never take down the public donation API. Instead the receipt
 * endpoint degrades gracefully to `503` when unconfigured (see `isMailerConfigured`).
 *
 * Required for receipts to work:
 *   SMTP_HOST – SMTP server hostname
 *   SMTP_USER – SMTP username (also the default From address)
 *   SMTP_PASS – SMTP password / app password
 * Optional:
 *   SMTP_PORT   – default 587
 *   SMTP_SECURE – "true"/"false"; defaults to true only on port 465 (implicit TLS)
 *   MAIL_FROM   – From header; defaults to SMTP_USER
 */

import nodemailer, { Transporter } from 'nodemailer';

const DEFAULT_PORT = 587;

export interface MailerConfig {
  host?: string;
  port: number;
  secure: boolean;
  user?: string;
  pass?: string;
  from: string;
}

export const getMailerConfig = (): MailerConfig => {
  const portRaw = Number(process.env.SMTP_PORT);
  const port = Number.isFinite(portRaw) && portRaw > 0 ? portRaw : DEFAULT_PORT;
  const user = process.env.SMTP_USER;

  return {
    host: process.env.SMTP_HOST,
    port,
    // Port 465 speaks implicit TLS (secure=true); 587/25 start plaintext then
    // STARTTLS (secure=false). SMTP_SECURE overrides the port-based default.
    secure: process.env.SMTP_SECURE
      ? process.env.SMTP_SECURE.toLowerCase() === 'true'
      : port === 465,
    user,
    pass: process.env.SMTP_PASS,
    from: process.env.MAIL_FROM || user || '',
  };
};

// True only when every secret the transport needs is present. The receipt
// handler short-circuits to 503 when this is false.
export const isMailerConfigured = (): boolean => {
  const { host, user, pass } = getMailerConfig();

  return Boolean(host && user && pass);
};

// Built once on first send and reused (nodemailer pools/keeps the connection),
// so we don't reconnect per email. Reset to null is never needed — config is
// read from the environment at process start.
let transporter: Transporter | null = null;

const getTransporter = (): Transporter => {
  if (!transporter) {
    const cfg = getMailerConfig();

    transporter = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure,
      auth: cfg.user && cfg.pass ? { user: cfg.user, pass: cfg.pass } : undefined,
    });
  }

  return transporter;
};

export interface MailOptions {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

// Sends one email. Callers should guard with isMailerConfigured() first; this
// rejects if the transport can't be reached, so fire-and-forget callers must
// catch the rejection themselves.
export const sendMail = async (opts: MailOptions): Promise<void> => {
  const { from } = getMailerConfig();

  await getTransporter().sendMail({
    from,
    to: opts.to,
    subject: opts.subject,
    text: opts.text,
    html: opts.html,
  });
};

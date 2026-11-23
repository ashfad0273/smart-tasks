interface Env {
  DB: D1Database;
  USER_HUB: DurableObjectNamespace<import('./hub').UserHub>;
  AUTH_LIMITER: RateLimit;
  /** Optional — only present once the send_email binding is enabled. */
  EMAIL?: SendEmail;
  GOOGLE_CLIENT_ID: string;
  EMAIL_FROM: string;
}

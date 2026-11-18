export * from "./errors";
export * from "./actor";
export * from "./filter";
export * from "./permissions";

/** Header names used across API, web and Bruno. */
export const HEADERS = {
  idempotencyKey: "idempotency-key",
  requestId: "x-request-id",
  devActor: "x-dev-actor",
  devScopes: "x-dev-scopes",
  csrf: "x-csrf-token",
} as const;

/** Cookie names of the web session (design module1 section 6.5). */
export const COOKIES = {
  session: "soe_session",
  /** Readable by the web app; sent back in the `X-CSRF-Token` header for writes (double submit). */
  csrf: "soe_csrf",
  oauthState: "soe_oauth",
} as const;

/** Business timezone: stored as UTC, displayed and period-bounded in Vietnam time. */
export const BUSINESS_TIMEZONE = "Asia/Ho_Chi_Minh";

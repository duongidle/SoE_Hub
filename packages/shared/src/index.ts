export * from "./errors";
export * from "./actor";
export * from "./filter";

/** Header names used across API, web and Bruno. */
export const HEADERS = {
  idempotencyKey: "idempotency-key",
  requestId: "x-request-id",
  devActor: "x-dev-actor",
  devScopes: "x-dev-scopes",
} as const;

/** Business timezone: stored as UTC, displayed and period-bounded in Vietnam time. */
export const BUSINESS_TIMEZONE = "Asia/Ho_Chi_Minh";

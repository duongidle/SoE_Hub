import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config";

const prod = { NODE_ENV: "production", DATABASE_URL: "postgres://x", STORAGE_SIGNING_SECRET: "s".repeat(40) };

describe("production configuration", () => {
  it("refuses to start without AUTH_SECRET, or with a default or short one", () => {
    expect(() => loadConfig(prod)).toThrow(/AUTH_SECRET phải được đặt/);
    expect(() => loadConfig({ ...prod, AUTH_SECRET: "dev-only-auth-secret-change-me-please" })).toThrow(/AUTH_SECRET/);
    expect(() => loadConfig({ ...prod, AUTH_SECRET: "a".repeat(20) })).toThrow(/AUTH_SECRET/);
    expect(loadConfig({ ...prod, AUTH_SECRET: "a".repeat(40) }).isProduction).toBe(true);
  });

  it("development works without it, and an empty GOOGLE_* variable means not set", () => {
    const c = loadConfig({ NODE_ENV: "development", DATABASE_URL: "postgres://x", GOOGLE_CLIENT_ID: "", GOOGLE_REDIRECT_URI: "" });
    expect(c.GOOGLE_CLIENT_ID).toBeUndefined();
    expect(c.GOOGLE_REDIRECT_URI).toBeUndefined();
  });
});

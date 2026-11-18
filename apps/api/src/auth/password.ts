import { argon2id, argon2Verify } from "hash-wasm";
import { randomBytes } from "node:crypto";
import { AppError } from "@soe/shared";
import { COMMON_PASSWORDS_TEXT } from "./common-passwords";

/** Password rules (design module1 section 6.5): 6 to 128 characters, no composition rules, ~1,000 common ones blocked. */
export const PASSWORD_MIN = 6;
export const PASSWORD_MAX = 128;

const COMMON = new Set(COMMON_PASSWORDS_TEXT.split("\n").map((s) => s.trim()).filter(Boolean));

export function isCommonPassword(pw: string): boolean {
  return COMMON.has(pw.toLowerCase());
}

/** Throws `password_rejected` with a reason the UI can show. */
export function assertPasswordPolicy(pw: string, ctx: { email?: string | null } = {}): void {
  const len = [...pw].length;
  if (len < PASSWORD_MIN) throw new AppError("password_rejected", `Mật khẩu cần tối thiểu ${PASSWORD_MIN} ký tự.`, { reason: "too_short" });
  if (len > PASSWORD_MAX) throw new AppError("password_rejected", `Mật khẩu tối đa ${PASSWORD_MAX} ký tự.`, { reason: "too_long" });
  if (isCommonPassword(pw)) throw new AppError("password_rejected", "Mật khẩu này quá phổ biến, dễ bị đoán. Hãy chọn mật khẩu khác.", { reason: "common" });
  const local = ctx.email?.split("@")[0]?.toLowerCase();
  if (local && local.length >= 3 && pw.toLowerCase() === local) {
    throw new AppError("password_rejected", "Mật khẩu không được trùng với tên email.", { reason: "same_as_email" });
  }
}

// OWASP minimum for argon2id: m=19 MiB, t=2, p=1.
const PARAMS = { parallelism: 1, iterations: 2, memorySize: 19456, hashLength: 32 } as const;

export async function hashPassword(pw: string): Promise<string> {
  return argon2id({ ...PARAMS, password: pw, salt: randomBytes(16), outputType: "encoded" });
}

export async function verifyPassword(hash: string, pw: string): Promise<boolean> {
  try {
    return await argon2Verify({ password: pw, hash });
  } catch {
    return false;
  }
}

let dummy: Promise<string> | null = null;
/** Spends the same time as a real check, so an unknown email cannot be told apart by timing. */
export async function verifyDummy(pw: string): Promise<void> {
  dummy ??= hashPassword("soe-dummy-password");
  await verifyPassword(await dummy, pw);
}

import { eq, sql } from "drizzle-orm";
import { AppError, isAppError } from "@soe/shared";
import { recordRowHistory, users, writeAudit, type Db } from "@soe/db";
import { loadConfig, type Config } from "./config";
import { createDb } from "@soe/db";
import { systemActor } from "./jobs";
import { issueCode, CODE_TTL_HOURS } from "./modules/auth/codes";
import { assertAllowedDomain, emailSchema, findPersonByEmail } from "./modules/org/view";
import { SETTINGS, readSetting } from "./modules/system/settings-catalog";

/**
 * Server commands (design module1 section 6.6). Run on the server only:
 *   pnpm cli admin:create --email <email> [--name "<họ tên>"]   create the first Admin, print an activation code
 *   pnpm cli auth:reset-code --email <email>                      print a password reset code (only Admin forgot)
 * In the Docker image: `docker compose exec api node dist/cli.js <command> ...`.
 * Every run is written to the audit log with via = worker and the command name.
 */
function arg(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

function parseEmail(raw: string | undefined): string {
  const r = emailSchema.safeParse(raw ?? "");
  if (!r.success) throw new AppError("validation_error", "Cần --email hợp lệ.");
  return r.data;
}

export async function adminCreate(db: Db, cfg: Config, rawEmail: string | undefined, name?: string): Promise<{ email: string; code: string; expiresAt: Date; created: boolean }> {
  const email = parseEmail(rawEmail);
  assertAllowedDomain(email, await readSetting(db, SETTINGS.allowedDomains));
  return db.transaction(async (tx) => {
    let u = await findPersonByEmail(tx, email);
    let created = false;
    if (u?.status === "active") throw new AppError("validation_error", "Tài khoản này đã kích hoạt. Dùng auth:reset-code nếu quên mật khẩu.");
    if (u?.status === "locked") throw new AppError("validation_error", "Tài khoản này đang bị khoá.");
    if (!u) {
      const [row] = await tx
        .insert(users)
        .values({ email, fullName: name ?? email.split("@")[0]!, roles: ["admin"], status: "inactive", createdBy: systemActor.userId, updatedBy: systemActor.userId })
        .returning();
      u = row!;
      created = true;
      await recordRowHistory(tx, { tableId: "users", rowId: u.id, version: 1, op: "create", changes: [{ field: "roles", old: null, new: ["admin"] }], actor: { userId: systemActor.userId, via: "worker", connectionId: null, automationId: null } });
    } else if (!u.roles.includes("admin")) {
      if (u.roles.includes("guest")) throw new AppError("validation_error", "Guest không kết hợp với vai trò khác.");
      await tx.update(users).set({ roles: [...u.roles, "admin"], version: sql`${users.version} + 1`, updatedAt: sql`now()`, updatedBy: systemActor.userId }).where(eq(users.id, u.id));
    }
    const issued = await issueCode(tx, cfg.AUTH_SECRET, { purpose: "activate", email, userId: u.id, source: "cli", ip: null });
    await writeAudit(tx, { command: "cli.admin.create", result: "success", actor: systemActor, targetType: "user", targetId: u.id, details: { email, created, code_id: issued.id } });
    return { email, code: issued.code, expiresAt: issued.expiresAt, created };
  });
}

export async function authResetCode(db: Db, cfg: Config, rawEmail: string | undefined): Promise<{ email: string; code: string; expiresAt: Date }> {
  const email = parseEmail(rawEmail);
  return db.transaction(async (tx) => {
    const u = await findPersonByEmail(tx, email);
    if (!u) throw new AppError("not_found", "Email chưa có trong org chart.");
    if (u.status !== "active") throw new AppError("validation_error", "Tài khoản chưa kích hoạt hoặc đang bị khoá. Dùng admin:create cho Admin chưa kích hoạt.");
    const issued = await issueCode(tx, cfg.AUTH_SECRET, { purpose: "reset", email, userId: u.id, source: "cli", ip: null });
    await writeAudit(tx, { command: "cli.auth.reset_code", result: "success", actor: systemActor, targetType: "user", targetId: u.id, details: { email, code_id: issued.id } });
    return { email, code: issued.code, expiresAt: issued.expiresAt };
  });
}

async function main(argv: string[]) {
  const [cmd] = argv;
  const cfg = loadConfig();
  const handle = createDb(cfg.DATABASE_URL, { max: 2, applicationName: "soe-cli" });
  try {
    if (cmd === "admin:create") {
      const r = await adminCreate(handle.db, cfg, arg(argv, "email"), arg(argv, "name"));
      console.log(`${r.created ? "Đã tạo" : "Đã cập nhật"} Admin ${r.email}.`);
      console.log(`Mã kích hoạt: ${r.code} (hết hạn sau ${CODE_TTL_HOURS} giờ, lúc ${r.expiresAt.toISOString()}).`);
      console.log("Mở trang Đăng ký, nhập email, chọn \"Tôi đã có mã\", nhập mã và đặt mật khẩu.");
    } else if (cmd === "auth:reset-code") {
      const r = await authResetCode(handle.db, cfg, arg(argv, "email"));
      console.log(`Mã đặt lại mật khẩu cho ${r.email}: ${r.code} (hết hạn sau ${CODE_TTL_HOURS} giờ).`);
      console.log("Mở trang Quên mật khẩu, chọn \"Tôi đã có mã\", nhập mã và mật khẩu mới.");
    } else {
      console.log("Lệnh: admin:create --email <email> [--name <họ tên>] | auth:reset-code --email <email>");
      process.exitCode = cmd ? 1 : 0;
    }
  } catch (e) {
    console.error(isAppError(e) ? `Lỗi: ${e.message}` : e);
    process.exitCode = 1;
  } finally {
    await handle.close();
  }
}

if (process.argv[1] && /cli\.(ts|js)$/.test(process.argv[1])) {
  await main(process.argv.slice(2));
}

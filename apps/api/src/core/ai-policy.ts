/**
 * What an AI / API connection may do (design module5 3.1-3.5, 12). ONE place maps every operation to a menu, an
 * access level and a forbidden group. Defaults come from the name rules below; an operation overrides them with the
 * optional `menu`, `access`, `forbidden` fields of its definition.
 *
 * - `menu`: the menu a connection must hold. `by_target` = decided by the datahub the call aims at
 *   (datahub "Quản lý Deal" -> `deal`, any other -> `datahub`), see `ai-target.ts`. `none` = always reachable (who am I).
 * - `access`: `read` (Xem), `write` (Sửa), `full` (Toàn quyền).
 * - `forbidden`: `hard` (never, even for Admin) or a group the Admin can switch on (`ai.groups_enabled`).
 */
import type { OperationKind } from "./types";

export const AI_MENUS = ["deal", "datahub", "form", "knowledge", "aihub", "workspace", "notify", "feedback", "admin"] as const;
export type AiMenu = (typeof AI_MENUS)[number];
export type MenuRef = AiMenu | "none" | "by_target";
export const AI_LEVELS = ["read", "write", "full"] as const;
export type AiAccess = (typeof AI_LEVELS)[number];
export const AI_GROUPS = ["org", "guest_grant", "transfer", "settings", "audit_log"] as const;
export type AiGroup = (typeof AI_GROUPS)[number];
export type AiForbidden = "hard" | AiGroup;

export const MENU_LABELS: Record<AiMenu, string> = {
  deal: "Quản lý Deal",
  datahub: "Datahub",
  form: "Form",
  knowledge: "Knowledge",
  aihub: "AI Hub",
  workspace: "Workspace",
  notify: "Thông báo và nhắc hẹn",
  feedback: "Feedback",
  admin: "Tài khoản và quản trị",
};
export const LEVEL_LABELS: Record<AiAccess, string> = { read: "Xem", write: "Sửa", full: "Toàn quyền" };
export const GROUP_LABELS: Record<AiGroup, string> = {
  org: "Tổ chức",
  guest_grant: "Cấp dữ liệu Guest",
  transfer: "Chuyển giao dữ liệu",
  settings: "Cài đặt hệ thống",
  audit_log: "Nhật ký",
};

/** Menus a new connection gets and at which level (module5 3.5). */
export const DEFAULT_CONNECTION_MENUS: Record<string, AiAccess> = {
  deal: "write",
  datahub: "write",
  notify: "write",
  form: "read",
  knowledge: "read",
  aihub: "read",
  workspace: "read",
  feedback: "read",
};

export interface AiPolicy {
  menu: MenuRef;
  access: AiAccess;
  forbidden?: AiForbidden;
}

interface Rule {
  match: RegExp;
  menu: MenuRef;
  forbidden?: AiForbidden;
}

/** First match wins. Order matters: specific names before prefixes. */
const RULES: Rule[] = [
  { match: /^onboarding\./, menu: "none", forbidden: "hard" },
  { match: /^auth\.me$/, menu: "none" },
  { match: /^auth\./, menu: "none", forbidden: "hard" },
  { match: /^system\.(ping|whoami)$/, menu: "none" },
  { match: /^system\.setting\./, menu: "admin", forbidden: "settings" },
  { match: /^system\.audit\./, menu: "admin", forbidden: "audit_log" },
  { match: /^(org\.tree\.transfer|data\.transfer\.)/, menu: "admin", forbidden: "transfer" },
  { match: /^org\./, menu: "admin", forbidden: "org" },
  { match: /^guest\.grant\.mine$/, menu: "datahub" },
  { match: /^guest\./, menu: "admin", forbidden: "guest_grant" },
  { match: /^(notification|reminder|announcement)\./, menu: "notify" },
  { match: /^file\./, menu: "datahub" },
  { match: /^form\./, menu: "form" },
  { match: /^skill\./, menu: "aihub" },
  { match: /^(knowledge|review|post)\./, menu: "knowledge" },
  { match: /^datahub\.limit\.mine$/, menu: "none" },
  { match: /^datahub\.limit\./, menu: "admin", forbidden: "settings" },
  { match: /^datahub\.prefs\.get$/, menu: "none" },
  { match: /^datahub\.(column\.types|formula\.functions|time_filter\.resolve)$/, menu: "none" },
  { match: /^datahub\.(datahub\.(create|list)|people\.lookup|job\.list)$/, menu: "datahub" },
  { match: /^datahub\.(template\.|deal\.)/, menu: "deal" },
  { match: /^datahub\./, menu: "by_target" },
  { match: /^metrics\.dashboard\.shared$/, menu: "datahub" },
  { match: /^metrics\./, menu: "by_target" },
  { match: /^(payment|commission|period|deal)\./, menu: "deal" },
];

/** Operations that need the top level even though they are commands. */
const FULL = new Set(["form.form.delete", "datahub.datahub.delete", "datahub.table.delete", "datahub.column.delete", "datahub.column.type_change"]);

/**
 * Input-dependent level: many deletes at once need `full` (module5 3.2). Returns null when the input does not raise the level.
 * Kept here, next to the table of names, so a new operation with bulk deletion is added in one place.
 */
export function accessOfInput(name: string, input: unknown): AiAccess | null {
  const i = (input ?? {}) as Record<string, unknown>;
  if (name === "datahub.row.batch" && Array.isArray(i.ops)) {
    const deletes = i.ops.filter((o) => (o as { op?: string })?.op === "delete").length;
    return deletes > 1 ? "full" : null;
  }
  if (name === "datahub.row.duplicates.resolve") return "full";
  // Import that replaces a table's rows wipes data (to the trash): top level.
  if (name === "datahub.import.start" && Array.isArray((i.mapping as { sheets?: unknown[] } | undefined)?.sheets)) {
    return (i.mapping as { sheets: { write?: string }[] }).sheets.some((s) => s?.write === "replace") ? "full" : null;
  }
  if (name === "datahub.row.restore_batch") return null;
  return null;
}

/**
 * Operations on the shared library (Knowledge, AI Hub): the menu follows the KIND of the post the call names, so they are declared under
 * `knowledge` here and `libraryMenu` (`ai-gate.ts`) decides at call time. Lists of open operations accept either menu.
 */
export const LIBRARY_OPS = /^(review|post)\./;

export interface AiOverrides {
  menu?: MenuRef;
  access?: AiAccess;
  forbidden?: AiForbidden;
}

/**
 * Resolves the policy of one operation. Returns null when nothing declares a menu for it: such an operation is
 * closed to connections, and the start-up test (`ai-policy.test.ts`) fails if it is also `aiAllowed`.
 */
export function resolveAiPolicy(d: { name: string; kind: OperationKind; aiAllowed: boolean } & AiOverrides): AiPolicy | null {
  const rule = RULES.find((r) => r.match.test(d.name));
  const menu = d.menu ?? rule?.menu;
  if (!menu) return null;
  const access: AiAccess = d.access ?? (FULL.has(d.name) ? "full" : d.kind === "query" ? "read" : "write");
  const forbidden: AiForbidden | undefined = d.aiAllowed ? (d.forbidden ?? rule?.forbidden) : "hard";
  return { menu, access, ...(forbidden ? { forbidden } : {}) };
}

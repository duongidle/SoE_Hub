import type { Column, TableDetail } from "./types";

/** Template tables of Quản lý Deal (Module 4 mục 3.2): which columns come from the template, which are yours, and where each is edited. */

export const isTemplateTable = (t: Pick<TableDetail, "template_id">): boolean => !!t.template_id;

const ROLE_LABEL: Record<string, string> = { manager: "Manager", leader: "Leader", user: "User" };

/** The tag on the header of a column: `Mẫu`, `Mẫu · Manager`, `Mẫu · Team Khuê`, `Riêng`. Null on an ordinary table. */
export function layerLabel(col: Column, table: Pick<TableDetail, "template_id">, leaderName?: string): string | null {
  if (!isTemplateTable(table)) return null;
  switch (col.layer) {
    case "custom":
      return "Riêng";
    case "role":
      return `Mẫu · ${(col.layer_roles ?? []).map((r) => ROLE_LABEL[r] ?? r).join(", ")}`;
    case "team":
      return `Mẫu · Team${leaderName ? ` ${leaderName}` : ""}`;
    case "basic":
      return "Mẫu";
    default:
      return null;
  }
}

/** What "Sửa ở đây áp dụng cho..." says for the column of a template table. */
export function layerScopeText(col: Column): string {
  return col.layer === "custom" ? "Chỉ mình bạn thấy cột này." : "Cột của template: sửa ở trang Template, áp dụng cho mọi người dùng template.";
}

/** May this person change the column from the table itself? An ordinary table: its owner. A template table: only the person's own custom columns. */
export function canEditColumnHere(table: Pick<TableDetail, "template_id" | "access">, col: Column, me: string | undefined): boolean {
  if (!isTemplateTable(table)) return table.access === "owner";
  return col.layer === "custom" && !!me && col.layer_ref === me;
}

/** May this person add a column from the table? Template table: everyone who sees it (the column is theirs alone). */
export const canAddColumnHere = (table: Pick<TableDetail, "template_id" | "access" | "kind">): boolean => table.kind !== "merged" && (isTemplateTable(table) || table.access === "owner");

export const templatePageUrl = (templateId: string, columnKey?: string): string => `/quan-ly-deal/template?template=${encodeURIComponent(templateId)}${columnKey ? `&column=${encodeURIComponent(columnKey)}` : ""}`;

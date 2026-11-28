import { ROLE_LABELS, type Role } from "@soe/shared";

/** A person as shown on screen. Only `id` and `full_name` are certain; the rest is what the server was willing to tell this viewer. */
export interface PersonInfo {
  id: string;
  full_name: string;
  email?: string | null;
  status?: string;
  roles?: string[] | null;
  team?: string | null;
  team_id?: string | null;
}

const key = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();
const localPart = (email: string) => email.split("@")[0]!;

/**
 * Display text per id for one list (a grid, a share list): the name alone, and when two different people in the list share a name,
 * the name plus the start of the email, "Nguyễn Văn A (vana.nt)". If even that start is the same, the whole email. Without an email
 * there is nothing to tell them apart with, so the name stays.
 */
export function disambiguate(people: readonly PersonInfo[]): Map<string, string> {
  const byId = new Map<string, PersonInfo>();
  for (const p of people) if (!byId.has(p.id)) byId.set(p.id, p);
  const groups = new Map<string, PersonInfo[]>();
  for (const p of byId.values()) (groups.get(key(p.full_name)) ?? groups.set(key(p.full_name), []).get(key(p.full_name))!).push(p);
  const out = new Map<string, string>();
  for (const list of groups.values()) {
    if (list.length === 1) {
      out.set(list[0]!.id, list[0]!.full_name);
      continue;
    }
    const locals = new Map<string, number>();
    for (const p of list) if (p.email) locals.set(localPart(p.email).toLowerCase(), (locals.get(localPart(p.email).toLowerCase()) ?? 0) + 1);
    for (const p of list) {
      if (!p.email) out.set(p.id, p.full_name);
      else out.set(p.id, `${p.full_name} (${locals.get(localPart(p.email).toLowerCase())! > 1 ? p.email : localPart(p.email)})`);
    }
  }
  return out;
}

/** The last two words' first letters, upper case ("Nguyễn Văn An" -> "VA"). A word with no letter (a number such as "12") is skipped, so "Thành viên 12G mwz" gives "VM", not "1M". */
export function initialsOf(name: string): string {
  const words = name.split(/\s+/).filter((w) => /\p{L}/u.test(w));
  return words.slice(-2).map((w) => Array.from(w.replace(/^[^\p{L}]+/u, ""))[0]!).join("").toUpperCase();
}

/** Status of a person in words: đang làm / đã nghỉ (khoá) / chưa kích hoạt. */
export function statusLabel(status: string | undefined): string | null {
  return status === "active" ? "Đang làm" : status === "locked" ? "Đã nghỉ" : status === "inactive" ? "Chưa kích hoạt" : null;
}

export const roleLabels = (roles: readonly string[] | null | undefined): string => (roles ?? []).map((r) => ROLE_LABELS[r as Role] ?? r).join(", ");

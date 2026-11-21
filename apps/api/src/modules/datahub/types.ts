import type { ColumnType } from "@soe/shared";

/** A stored cell value: what lives in `dh_rows.data` under the column key. `null` = empty (the key is removed). */
export type Stored = string | number | boolean | string[] | PersonEntry[] | null;

/** One person in a "Người dùng có thuộc tính" cell (design module4 4.5): the person and their attributes (role label, share in percent, yes/no). */
export interface PersonEntry {
  id: string;
  attrs: Record<string, string | number | boolean>;
}

/** A column definition as the engine sees it (row of `dh_columns`). */
export interface DhColumn {
  id: string;
  tableId: string;
  key: string;
  name: string;
  type: ColumnType;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  config: Record<string, any>;
  position: number;
  required: boolean;
  /** A member (not the owner) with the Edit permission may write this column's cells (design module2 section 10). */
  allowEdit: boolean;
  /** The value depends on who reads it (design module2 section 10): the owner's value is in `dh_rows.data`, each member's in `dh_personal_rows`. */
  readerScoped: boolean;
  /** Template layer (module4 3.1): null = ordinary column; `basic` | `role` | `team` | `custom`. */
  layer: "basic" | "role" | "team" | "custom" | null;
  /** `team`: the Leader whose team sees the column; `custom`: the person who made it (and the only one who sees it). */
  layerRef: string | null;
  /** `role` layer: the roles that see the column. */
  layerRoles: string[] | null;
  /** `shared` (value in `dh_rows.data`) or `person` (one value per person, `dh_person_cells`). */
  storage: "shared" | "person";
  /** Column role (module4 3.7), unique per table. */
  role: string | null;
  /** Filled by the system from the attributes of the people in a user column of the row (module4 4.5): `person` storage only. */
  autofill: Autofill | null;
  /** Template column: not renamed, deleted, retyped or edited from the column commands. */
  protected: boolean;
  isUnique: boolean;
  defaultValue: unknown;
  description: string | null;
  display: Record<string, unknown>;
  version: number;
  deletedAt: Date | null;
  /** Recalculation state of a computed column: `ready`, `pending` (waiting for the worker) or `running`. */
  calcStatus: string;
  calcDone: number | null;
  calcTotal: number | null;
  calcAt: Date | null;
  /** Highest change sequence the column has incorporated (design module2 section 6.7). */
  calcSeq: number;
}

/** Where an autofilled column takes its value: the attribute `attr` of each person in the user column `column` (by key). `sum`: the value of a Leader (`team`) or Manager (`tree`) is the total over the people they manage. */
export interface Autofill {
  column: string;
  attr: string;
  sum?: "team" | "tree";
}

export interface SelectOption {
  id: string;
  name: string;
  color?: string;
  /** What a status option means to the functions that read it (module4 3.7: "gắn nghĩa theo mã", so a rename breaks nothing). Only the status column of a table with roles has it. */
  meaning?: OptionMeaning;
}

export type OptionMeaning = "open" | "won" | "lost" | "disqualified" | "converted" | "cancelled" | "committed" | "ledger_temp" | "ledger_closed" | "ledger_adjust";
export const OPTION_MEANINGS: OptionMeaning[] = ["open", "won", "lost", "disqualified", "converted", "cancelled", "committed", "ledger_temp", "ledger_closed", "ledger_adjust"];
/** A closed deal: anything that is not "open". */
export const isClosedMeaning = (m: OptionMeaning | undefined): boolean => m !== undefined && m !== "open" && m !== "committed" && m !== "ledger_temp" && m !== "ledger_closed" && m !== "ledger_adjust";

/** Thrown by column-type validation. The message never contains the cell value (it may end up in the audit log). */
export class CellError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CellError";
  }
}

/** Column keys go straight into SQL text (index expressions, JSONB paths), so they must match this exactly. */
export const COLUMN_KEY_RE = /^[a-z][a-z0-9_]{0,29}$/;

export function assertColumnKey(key: string): string {
  if (!COLUMN_KEY_RE.test(key)) throw new Error(`Mã cột không hợp lệ: ${key}`);
  return key;
}

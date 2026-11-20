import type { ColumnType } from "@soe/shared";

/** A stored cell value: what lives in `dh_rows.data` under the column key. `null` = empty (the key is removed). */
export type Stored = string | number | boolean | string[] | null;

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

export interface SelectOption {
  id: string;
  name: string;
  color?: string;
}

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

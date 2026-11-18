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
  isUnique: boolean;
  defaultValue: unknown;
  description: string | null;
  display: Record<string, unknown>;
  version: number;
  deletedAt: Date | null;
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

import type { Node } from "./ast";
import type { FType, RangeValue, Scalar, Value } from "./types";

/** Returned by a grouped plan when the key matches no row (XLOOKUP and friends then use "if not found"). */
export const NOT_FOUND = Symbol("not-found");

/** An answer prepared for a whole column by one grouped SQL query (design module2 section 6.6). */
export interface GroupPlan {
  /** `criteria`: COUNTIFS family (a blank key counts as 0). `lookup`: XLOOKUP family (a blank key finds nothing). */
  kind: "criteria" | "lookup";
  /** Expressions of the current row that form the key; evaluated per row, then looked up. */
  keyNodes: Node[];
  /** Answer for one key. Return `undefined` to say "this plan cannot answer, scan instead". */
  lookup(keys: Scalar[]): Value | typeof NOT_FOUND | undefined;
  /** For lookups: index of the "if not found" argument of the call (XLOOKUP: 3). */
  notFoundArg?: number;
}

export interface RowInfo {
  id: string;
  rowNo: number;
  /** Serials in Vietnam time, or null when unknown (preview of a row that does not exist yet). */
  createdAt: number | null;
  modifiedAt: number | null;
}

/** What the evaluator needs from its host: the current row, other tables, the clock. Built by the server or the browser. */
export interface EvalContext {
  now: Date;
  /** Value of a column of the current row, by column key. */
  cell(key: string): Value;
  /** A whole column of a table (this one or another). Errors (`#REF!`, `#PERM!`, too large) are thrown as `FError`. */
  range(table: string, key: string): RangeValue;
  rowInfo(): RowInfo;
  /** The person who reads the value (viewer functions): the owner for the owner's pass, the member for a member's pass. Absent where there is no viewer. */
  me?(): string | null;
  /** The attribute `name` (label or code) of `person` in the user cell `key` of the current row; null when the person is not in the cell. */
  attr?(key: string, person: string, name: string): Scalar;
  /** The ids in the viewer's scope: the viewer and the people under them (a Leader's team, a Manager's tree). Absent where there is no viewer. */
  scope?(): string[] | null;
  /** The sum of the numeric attribute `name` over the people of the user cell `key` of the current row; only those in the viewer's scope when `mine`. */
  attrSum?(key: string, name: string, mine: boolean): number;
  /** Grouped plans by call-node id. */
  plans?: Map<number, GroupPlan>;
}

/** What a function needs while it runs. */
export interface FnCtx extends EvalContext {
  now: Date;
}

export type RetType = FType | ((args: FType[]) => FType);

export interface FnDef {
  name: string;
  group: "Logic" | "Toán" | "Thống kê" | "Chuỗi" | "Ngày" | "Tra cứu" | "Thông tin dòng" | "Người xem";
  /** Syntax shown in the editor, e.g. `IF(điều_kiện, nếu_đúng, nếu_sai)`. */
  syntax: string;
  /** Short Vietnamese description. */
  description: string;
  /** One example formula (the result is in `exampleResult`). */
  example: string;
  exampleResult: string;
  min: number;
  max: number;
  returns: RetType;
  /** Not volatile unless set: TODAY and NOW. */
  volatile?: "today" | "now";
  /** Arguments are evaluated on demand (IF, IFERROR, ...). */
  lazy?: (nodes: Node[], ev: (n: Node) => Value, c: FnCtx) => Value;
  impl?: (args: Value[], c: FnCtx) => Value;
}

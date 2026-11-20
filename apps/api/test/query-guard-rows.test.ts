import { describe, expect, it } from "vitest";
import { UnscopedQueryError, checkScopedQuery } from "../src/auth/query-guard";
import "../src/modules/datahub";

/** 4.2: a query on `dh_rows` must carry the row marker (`TableAccess.rows()`) or the system marker; the plain `scope()` marker is not enough. */
describe("query guard on dh_rows", () => {
  it("refuses dh_rows reached with only the table-access marker or no marker", () => {
    expect(() => checkScopedQuery("SELECT id FROM dh_rows WHERE /*scope*/ table_id = $1::uuid")).toThrow(UnscopedQueryError);
    expect(() => checkScopedQuery("UPDATE dh_rows r SET data = '{}' WHERE /*scope*/ r.table_id = $1::uuid")).toThrow(UnscopedQueryError);
    expect(() => checkScopedQuery("SELECT 1 FROM dh_columns c JOIN dh_rows r ON r.table_id = c.table_id WHERE /*scope*/ c.table_id = $1")).toThrow(UnscopedQueryError);
    expect(() => checkScopedQuery("SELECT id FROM dh_rows")).toThrow(UnscopedQueryError);
  });

  it("accepts the row marker and the system marker; other datahub tables still take the plain marker", () => {
    expect(() => checkScopedQuery("SELECT id FROM dh_rows WHERE /*scope:rows*/ table_id = $1::uuid")).not.toThrow();
    expect(() => checkScopedQuery("UPDATE dh_rows SET data = '{}' WHERE /*scope:system*/ table_id = $1::uuid")).not.toThrow();
    expect(() => checkScopedQuery("SELECT * FROM dh_columns WHERE /*scope*/ table_id = $1::uuid")).not.toThrow();
    expect(() => checkScopedQuery("INSERT INTO dh_rows (id) VALUES ($1)")).not.toThrow();
    expect(() => checkScopedQuery("SELECT * FROM dh_columns")).toThrow(UnscopedQueryError);
  });
});

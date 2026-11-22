import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, drainOutbox, makeTable, unlimit } from "./dh-helpers";
import { activeToken, seedOrg, type Org } from "./fixtures";
import { makeApp, type TestApp } from "./helpers";
import { BUILTIN_DEFAULT_SET, DEAL_DASHBOARD_NAME, ensureDealDashboard, ensureTreeTemplates } from "../src/modules/deal";
import { workerEmit } from "../src/modules/datahub/template-sync";
import { processPendingColumns } from "../src/modules/datahub";

/**
 * Stage 5A2: `/mcp` (design module5 1, 4, 12). Handshake, tools by menu, pending connections, the generic tools and the six selective ones.
 * Invented data only. Tree A: MgrA > LeaderA > UserA1, MgrA > UserA2. Tree B: MgrB > LeaderB > UserB1.
 */
let t: TestApp;
let org: Org;
let mgrA: ReturnType<typeof as>;
let mgrB: ReturnType<typeof as>;
let userA1: ReturnType<typeof as>;
const tables: Record<string, string> = {};
const person = (id: string, attrs: Record<string, unknown> = {}) => ({ id, attrs });
const dealData = (name: string, who: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  "Tên công ty": name,
  "Loại deal": "POD bán mới",
  "Start date": "2026-06-10",
  "Ngày dự kiến chốt": "2026-07-01",
  "Doanh thu dự kiến": 1_000,
  "Nguồn lead": "ML",
  "Level BC": "Level 1",
  "Performance BC": "KPI",
  "Người tham gia": [person(who, { vai_tro: "Leading", ty_le_com: 0.1 })],
  ...extra,
});
const settle = async () => {
  await drainOutbox(t);
  await processPendingColumns(t.c.db.db);
  await drainOutbox(t);
  await processPendingColumns(t.c.db.db);
  await drainOutbox(t);
};

type Menus = Record<string, "read" | "write" | "full">;
const ALL: Menus = { deal: "write", datahub: "write", form: "read", knowledge: "read", aihub: "read", workspace: "read", notify: "write", feedback: "read" };

async function rpc(token: string | null, method: string, params: Record<string, unknown> = {}, id: number | null = 1) {
  const r = await t.app.inject({ method: "POST", url: "/mcp", headers: token ? { authorization: `Bearer ${token}` } : {}, payload: { jsonrpc: "2.0", ...(id !== null ? { id } : {}), method, params } });
  return { status: r.statusCode, headers: r.headers, body: r.body ? r.json() : null };
}
/** A connection (active personal token) and a caller of its tools; `tool` returns the MCP result. */
async function connect(userId: string, menus: Menus = ALL, status: "pending" | "active" = "active") {
  const tk = await activeToken(t, userId, [], { menus, status, name: "claude-test" });
  const tool = async (name: string, args: Record<string, unknown> = {}) => (await rpc(tk.token, "tools/call", { name, arguments: args })).body.result as { isError?: boolean; structuredContent: any; content: { text: string }[] }; // eslint-disable-line @typescript-eslint/no-explicit-any
  const list = async () => ((await rpc(tk.token, "tools/list")).body.result.tools as { name: string; annotations: Record<string, unknown> }[]);
  return { tk, tool, list };
}
const colIx = (r: { columns: string[] }, name: string) => r.columns.indexOf(name);

beforeAll(async () => {
  t = await makeApp();
  org = await seedOrg(t);
  for (const p of [org.userA1, org.userA2, org.userB1, org.leaderA, org.mgrA, org.mgrB]) await unlimit(t, p.id);
  mgrA = as(t, org.mgrA.id);
  mgrB = as(t, org.mgrB.id);
  userA1 = as(t, org.userA1.id);
  for (const m of [org.mgrA, org.mgrB]) await ensureTreeTemplates(t.c.db.db, workerEmit(t.c.db.db), m.id);
  await drainOutbox(t);
  const la = await mgrA("datahub.template.list");
  for (const d of BUILTIN_DEFAULT_SET) tables[d.name] = la.find((x: { name: string }) => x.name === d.name).master_table_id;
  await mgrA("datahub.row.create", { table_id: tables["Chính sách com"]!, data: { "Hiệu lực từ": "2026-01-01", "Nguồn lead": "ML", Level: "Level 1", Performance: "KPI", "Tỉ lệ": 0.2 } });
  await mgrA("datahub.row.create", { table_id: tables["Tham số com"]!, data: { "Hiệu lực từ": "2026-01-01", "Tên tham số": "Tỉ lệ SoE", "Giá trị": 0.5 } });
  // Tree A: a deal of UserA1 with a paid instalment (revenue 100 000 000), then 50 more deals of UserA1 (a page of results to measure).
  const d = await mgrA("datahub.row.create", { table_id: tables["Deals"]!, data: dealData("Công ty Một", org.userA1.id) });
  const sch = await mgrA("payment.schedule", { deal_id: d.id, payments: [{ legal_entity: "CT Một", amount: 100_000_000, due: "2026-07-01" }] });
  await settle();
  await mgrA("payment.confirm", { received_on: "2026-07-03", receipt: { amount: 100_000_000 }, allocations: [{ payment_id: sch.payments[0].id, amount: 100_000_000 }] });
  await mgrA("datahub.row.batch", { table_id: tables["Deals"]!, ops: Array.from({ length: 50 }, (_, i) => ({ op: "create", data: dealData(`Công ty Lô ${i + 1}`, org.userA1.id) })) });
  // Tree B: one deal of UserB1.
  const lb = await mgrB("datahub.template.list");
  const dealsB = lb.find((x: { name: string }) => x.name === "Deals").master_table_id as string;
  await mgrB("datahub.row.create", { table_id: dealsB, data: dealData("Công ty Của B", org.userB1.id) });
  await settle();
  const dh = (await mgrA("datahub.table.get", { table_id: tables["Deals"]! })).datahub_id as string;
  await ensureDealDashboard((op, input) => mgrA(op, input), t.c.db.db, dh);
});
afterAll(async () => {
  await t.close();
});

describe("transport and handshake", () => {
  it("answers 401 with WWW-Authenticate without a token, with a service token or with a bad one", async () => {
    const none = await rpc(null, "initialize");
    expect(none.status).toBe(401);
    expect(String(none.headers["www-authenticate"])).toMatch(/^Bearer/);
    const svc = await activeToken(t, org.admin.id, ["system:whoami"], { kind: "service" });
    expect((await rpc(svc.token, "tools/list")).status).toBe(401);
    expect((await rpc("soe_pat_nope", "tools/list")).status).toBe(401);
    const get = await t.app.inject({ method: "GET", url: "/mcp" });
    expect(get.statusCode).toBe(405);
  });

  it("initialize, ping, a notification and an unknown method", async () => {
    const c = await connect(org.userA1.id);
    const init = await rpc(c.tk.token, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } });
    expect(init.body.result).toMatchObject({ protocolVersion: "2025-06-18", serverInfo: { name: "soe-hub" }, capabilities: { tools: {} } });
    expect((await rpc(c.tk.token, "ping")).body.result).toEqual({});
    expect((await rpc(c.tk.token, "notifications/initialized", {}, null)).status).toBe(202);
    expect((await rpc(c.tk.token, "nope/nope")).body.error.code).toBe(-32601);
  });
});

describe("tools/list follows the menus of the connection", () => {
  it("a Datahub-only connection sees no Deal tool; a full one sees all eighteen (Form at read level: no form_save; Knowledge at read level: no knowledge_submit, no review_decide); annotations come from the kind", async () => {
    const dh = await connect(org.userA1.id, { datahub: "write" });
    const names = (await dh.list()).map((x) => x.name);
    expect(names).toEqual(expect.arrayContaining(["soe_whoami", "soe_operations", "soe_describe", "soe_call", "rows_query", "rows_write", "metrics_query"]));
    expect(names).not.toContain("deals_list");
    expect(names).not.toContain("deal_get");
    expect(names).not.toContain("deal_metrics");
    const read = await connect(org.userA1.id, { datahub: "read" });
    expect((await read.list()).map((x) => x.name)).not.toContain("rows_write");
    const full = await connect(org.userA1.id);
    const all = await full.list();
    expect(all.map((x) => x.name).sort()).toEqual(["deal_get", "deal_metrics", "deals_list", "form_get", "form_responses", "knowledge_get", "knowledge_search", "metrics_query", "notifications_list", "reminder_create", "review_get", "review_queue", "rows_query", "rows_write", "soe_call", "soe_describe", "soe_operations", "soe_whoami"]);
    expect(all.find((x) => x.name === "rows_query")!.annotations.readOnlyHint).toBe(true);
    expect(all.find((x) => x.name === "soe_call")!.annotations.destructiveHint).toBe(true);
    // Token weight of the whole list (module5 4.4: chars / 4).
    const chars = JSON.stringify((await rpc(full.tk.token, "tools/list")).body.result).length;
    console.warn(`MCP tools/list full connection: ${chars} chars, ~${Math.round(chars / 4)} tokens, ${all.length} tools`);
  });

  it("a Datahub-only connection cannot reach the Deal tables through rows_query either", async () => {
    const dh = await connect(org.mgrA.id, { datahub: "write" });
    const r = await dh.tool("rows_query", { table_id: tables["Deals"]! });
    expect(r.isError).toBe(true);
    expect(r.structuredContent.code).toBe("forbidden");
    expect(r.structuredContent.message).toContain("chưa có menu Quản lý Deal");
  });
});

describe("a connection waiting for approval", () => {
  it("shakes hands and lists tools, every tool answers connection_pending", async () => {
    const c = await connect(org.userA1.id, ALL, "pending");
    expect((await rpc(c.tk.token, "initialize", { protocolVersion: "2025-06-18" })).status).toBe(200);
    expect((await c.list()).length).toBeGreaterThan(0);
    for (const name of ["soe_whoami", "deals_list", "rows_query"]) {
      const r = await c.tool(name, name === "rows_query" ? { table_id: tables["Deals"]! } : {});
      expect(r.isError, name).toBe(true);
      expect(r.structuredContent.code, name).toBe("connection_pending");
    }
  });
});

describe("generic tools", () => {
  it("soe_whoami tells who and what this connection holds", async () => {
    const c = await connect(org.userA1.id, { deal: "read", datahub: "write" });
    const r = await c.tool("soe_whoami");
    expect(r.isError).toBeUndefined();
    expect(r.structuredContent.user.email).toBe(org.userA1.email);
    expect(r.structuredContent.connection.menus).toEqual({ deal: "read", datahub: "write" });
    expect(r.structuredContent.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(r.structuredContent.quarter.id).toMatch(/^\d{4}-Q[1-4]$/);
    expect(r.content[0]!.text).toContain(org.userA1.email);
  });

  it("soe_operations lists by menu and level, soe_describe gives the schema, soe_call runs it; hard bans are refused", async () => {
    const c = await connect(org.userA1.id, { datahub: "read" });
    const ops = (await c.tool("soe_operations", { q: "row." })).structuredContent;
    const lines = ops.operations as string[];
    expect(lines.some((l) => l.startsWith("datahub.row.list|read|"))).toBe(true);
    expect(lines.some((l) => l.startsWith("datahub.row.create|"))).toBe(false); // needs Sửa
    expect(lines.some((l) => l.startsWith("auth.token.create|"))).toBe(false); // hard ban
    expect((await c.tool("soe_operations", { menu: "deal" })).structuredContent.total).toBe(0);
    const d = (await c.tool("soe_describe", { operation: "datahub.row.list" })).structuredContent;
    expect(d.input_schema.properties.table_id).toBeDefined();
    expect((await c.tool("soe_describe", { operation: "auth.token.create" })).structuredContent.code).toBe("forbidden");
    const x = await makeTable(userA1, { columns: [{ name: "Tên", type: "text" }] });
    await userA1("datahub.row.create", { table_id: x.tableId, data: { Tên: "a" } });
    const listed = await c.tool("soe_call", { operation: "datahub.row.list", input: { table_id: x.tableId } });
    expect(listed.structuredContent.items).toHaveLength(1);
    expect(listed.structuredContent).toHaveProperty("next_cursor");
    // A hard ban and an operation made web-only are refused with ai_not_allowed; a write over a read-only connection is forbidden.
    for (const [op, input] of [["auth.token.create", { name: "x" }], ["period.close", { month: "2026-06" }]] as const) {
      const r = await c.tool("soe_call", { operation: op, input });
      expect(r.isError, op).toBe(true);
      expect(r.structuredContent.code, op).toBe("ai_not_allowed");
      expect(r.structuredContent.hint).toBeTruthy();
    }
    const w = await c.tool("soe_call", { operation: "datahub.row.create", input: { table_id: x.tableId, data: { Tên: "b" } } });
    expect(w.structuredContent.code).toBe("forbidden");
    expect((await c.tool("soe_call", { operation: "nope.nope.nope" })).structuredContent.code).toBe("not_found");
  });
});

describe("deals_list, deal_get, deal_metrics", () => {
  it("a User sees only own deals, never another tree's; the Leader sees the team; filters by status and period work", async () => {
    const u = await connect(org.userA1.id);
    const all = (await u.tool("deals_list", { limit: 500 })).structuredContent;
    expect(all.total).toBe(51);
    const nameAt = colIx(all, "Tên công ty");
    const names = (all.rows as unknown[][]).map((r) => r[nameAt] as string);
    expect(names).not.toContain("Công ty Của B");
    expect(names).toContain("Công ty Một");
    // The deal of User B1 is not visible to a User of tree A, nor to another tree's leader.
    const b = await connect(org.userB1.id);
    const bl = (await b.tool("deals_list", {})).structuredContent;
    expect((bl.rows as unknown[][]).map((r) => r[colIx(bl, "Tên công ty")])).toEqual(["Công ty Của B"]);
    // A2 has no deal; the Leader of A sees the team's.
    expect((await (await connect(org.userA2.id)).tool("deals_list", {})).structuredContent.total).toBe(0);
    const lead = await connect(org.leaderA.id);
    expect((await lead.tool("deals_list", {})).structuredContent.total).toBe(51);
    // Machine form: participants as {name,email,...}, dates ISO, money numbers, 50 rows by default, cursor to go on.
    const page = (await u.tool("deals_list", {})).structuredContent;
    expect(page.rows).toHaveLength(50);
    expect(page.next_cursor).toBeTruthy();
    const first = (page.rows as unknown[][])[0]!;
    const who = first[colIx(page, "Người tham gia")] as { name: string; email: string }[];
    expect(who[0]!.email).toBe(org.userA1.email);
    expect(first[colIx(page, "Start date")]).toBe("2026-06-10");
    const next = (await u.tool("deals_list", { cursor: page.next_cursor })).structuredContent;
    expect(next.rows).toHaveLength(1);
    // Filters: status by meaning, period, mine, search.
    expect((await u.tool("deals_list", { status: "won" })).structuredContent.total).toBe(1);
    expect((await u.tool("deals_list", { status: "open" })).structuredContent.total).toBe(50);
    expect((await u.tool("deals_list", { status: "lost" })).structuredContent.total).toBe(0);
    expect((await u.tool("deals_list", { period: "2026-06", period_mode: "received" })).structuredContent.total).toBe(51);
    expect((await u.tool("deals_list", { period: "2025-06", period_mode: "received" })).structuredContent.total).toBe(0);
    expect((await u.tool("deals_list", { scope: "mine" })).structuredContent.total).toBe(51);
    expect((await lead.tool("deals_list", { scope: "mine" })).structuredContent.total).toBe(0);
    expect((await u.tool("deals_list", { search: "Công ty Một" })).structuredContent.total).toBe(1);
    const bad = await u.tool("deals_list", { fields: ["Cột không có"] });
    expect(bad.structuredContent.code).toBe("validation_error");
    expect(bad.structuredContent.details.valid_columns.length).toBeGreaterThan(5);
  });

  it("deal_get gives the deal with participants, instalments and the person's own commission lines", async () => {
    const u = await connect(org.userA1.id);
    const list = (await u.tool("deals_list", { search: "Công ty Một" })).structuredContent;
    const id = (list.rows as unknown[][])[0]![0] as string;
    const g = (await u.tool("deal_get", { deal_id: id })).structuredContent;
    expect(g.data["Tên công ty"]).toBe("Công ty Một");
    expect(g.participants[0].email).toBe(org.userA1.email);
    expect(g.payments.rows).toHaveLength(1);
    expect(g.history.length).toBeGreaterThan(0);
    // Another tree's deal does not exist for this person.
    const b = await connect(org.userB1.id);
    const bid = ((await b.tool("deals_list", {})).structuredContent.rows as unknown[][])[0]![0] as string;
    expect((await u.tool("deal_get", { deal_id: bid })).structuredContent.code).toBe("not_found");
  });

  it("deal_metrics gives the same numbers as the system dashboard for that person", async () => {
    const view = async (call: ReturnType<typeof as>, title: string) => {
      const dh = (await call("datahub.table.get", { table_id: tables["Deals"]! })).datahub_id as string;
      void dh;
      const shared = (await call("metrics.dashboard.shared")) as { items?: { id: string; name: string }[] } | { id: string; name: string }[];
      const id = (Array.isArray(shared) ? shared : shared.items!).find((d) => d.name === DEAL_DASHBOARD_NAME)!.id;
      const dv = await call("metrics.dashboard.view", { dashboard_id: id });
      const chart = (dv.charts as { id: string; chart: { title?: string } }[]).find((c) => c.chart.title === title)!;
      return (await call("metrics.chart.data", { chart_id: chart.id })).series[0].rows[0]?.value ?? null;
    };
    const u = await connect(org.userA1.id);
    const r = (await u.tool("deal_metrics", {})).structuredContent;
    const m = Object.fromEntries((r.metrics as { name: string; value: unknown }[]).map((x) => [x.name, x.value]));
    expect(m["Doanh thu tính cho tôi"]).toBeGreaterThanOrEqual(100_000_000);
    expect(m["Doanh thu tính cho tôi"]).toBe(await view(userA1, "Doanh thu tính cho tôi"));
    expect(m["Số deal của tôi"]).toBe(await view(userA1, "Số deal của tôi"));
    // Another person of the same tree gets their own figures (A2 has no revenue).
    const u2 = await connect(org.userA2.id);
    const m2 = Object.fromEntries(((await u2.tool("deal_metrics", {})).structuredContent.metrics as { name: string; value: unknown }[]).map((x) => [x.name, x.value]));
    expect(m2["Doanh thu tính cho tôi"] ?? 0).toBe(0);
    // Chosen by title; a connection without the Deal menu does not get the tool at all.
    const one = (await u.tool("deal_metrics", { names: ["forecast"] })).structuredContent;
    expect(one.metrics.map((x: { name: string }) => x.name)).toEqual(expect.arrayContaining(["Forecast đã ký (quý này)", "Forecast chưa ký (quý này)"]));
  });

  it("measures a 50-row page of deals_list", async () => {
    const u = await connect(org.userA1.id);
    const r = await u.tool("deals_list", {});
    const chars = JSON.stringify(r.structuredContent).length;
    console.warn(`MCP deals_list 50 rows: structured ${chars} chars (~${Math.round(chars / 4)} tokens), text ${r.content[0]!.text.length} chars`);
    expect(r.structuredContent.rows).toHaveLength(50);
  });
});

describe("rows_query and rows_write", () => {
  let tableId: string;
  beforeAll(async () => {
    const x = await makeTable(userA1, { columns: [{ name: "Tên", type: "text" }, { name: "Số", type: "number" }, { name: "Mã", type: "text", unique: true }, { name: "Ai", type: "user" }] });
    tableId = x.tableId;
    await userA1("datahub.share.set", { datahub_id: x.dhId, grantee_id: org.userA2.id, permission: "edit_data" });
  });

  it("a batch with two rows tagging a non-member writes eight and reports the two; reading right after shows the new numbers", async () => {
    const c = await connect(org.userA1.id);
    const rows = Array.from({ length: 10 }, (_, i) => ({ data: { Tên: `Dòng ${i}`, Số: i * 10, Mã: `M${i}`, Ai: i === 3 || i === 7 ? org.userB1.email : org.userA2.email } }));
    const w = (await c.tool("rows_write", { table_id: tableId, rows })).structuredContent;
    expect(w.written).toBe(8);
    expect(w.skipped.map((s: { row: number }) => s.row).sort()).toEqual([3, 7]);
    expect(w.skipped[0].column).toBe("Ai");
    expect(w.skipped[0].reason).toBeTruthy();
    expect(typeof w.seq).toBe("number");
    const q = (await c.tool("rows_query", { table_id: tableId, sort: [{ field: "Số", dir: "asc" }] })).structuredContent;
    expect(q.total).toBe(8);
    expect(q.stale).toBeUndefined();
    expect((q.rows as unknown[][]).map((r) => r[colIx(q, "Số")])).toEqual([0, 10, 20, 40, 50, 60, 80, 90]);
    const first = (q.rows as unknown[][])[0]!;
    expect((first[colIx(q, "Ai")] as { email: string }).email).toBe(org.userA2.email);
    // Update by _id with _version, then read the new value at once; an update without version/base is skipped, not guessed.
    const upd = (await c.tool("rows_write", { table_id: tableId, rows: [{ id: first[0], version: first[1], data: { Số: 999 } }, { id: (q.rows as unknown[][])[1]![0], data: { Số: 1 } }] })).structuredContent;
    expect(upd.written).toBe(1);
    expect(upd.skipped).toHaveLength(1);
    const again = (await c.tool("rows_query", { table_id: tableId, filter: { field: "Số", op: "eq", value: 999 }, fields: ["Tên", "Số"] })).structuredContent;
    expect(again.rows).toHaveLength(1);
    expect(again.columns).toEqual(["_id", "_version", "Tên", "Số"]);
    // Upsert by a unique column.
    const up = (await c.tool("rows_write", { table_id: tableId, key: "Mã", rows: [{ data: { Mã: "M0", Số: 1234 } }, { data: { Mã: "M99", Số: 1, Tên: "Mới" } }] })).structuredContent;
    expect(up.results.map((r: { outcome: string }) => r.outcome)).toEqual(["updated", "created"]);
  });

  it("a read-only connection cannot write; a wrong column name lists the right ones; over 500 rows is refused", async () => {
    const r = await connect(org.userA1.id, { datahub: "read" });
    expect((await r.tool("rows_write", { table_id: tableId, rows: [{ data: { Tên: "x" } }] })).structuredContent.code).toBe("forbidden");
    const c = await connect(org.userA1.id);
    const bad = (await c.tool("rows_query", { table_id: tableId, fields: ["Soo"] })).structuredContent;
    expect(bad.code).toBe("validation_error");
    expect(bad.details.did_you_mean).toContain("Số");
    const many = (await c.tool("rows_write", { table_id: tableId, rows: Array.from({ length: 501 }, () => ({ data: { Tên: "x" } })) })).structuredContent;
    expect(many.code).toBe("validation_error");
  });

  it("metrics_query computes on the server within the caller's rights", async () => {
    const c = await connect(org.userA1.id);
    const r = (await c.tool("metrics_query", { metric: { name: "Tổng", source: tableId, measure: { agg: "sum", field: "Số" } } })).structuredContent;
    expect(r.rows[0].value).toBeGreaterThan(0);
    const other = await connect(org.userB1.id);
    expect((await other.tool("metrics_query", { metric: { name: "Tổng", source: tableId, measure: { agg: "sum", field: "Số" } } })).isError).toBe(true);
  });
});

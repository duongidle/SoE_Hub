import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, fails, unlimit } from "./dh-helpers";
import { seedOrg, type Org } from "./fixtures";
import { makeApp, type TestApp } from "./helpers";

/** Stage 4.3: the tables of the menu Quản lý Deal (`datahub.deal.home`) and the "Áp dụng cho N người" preview (`datahub.template.impact`). Tree A: MgrA > LeaderA > UserA1, MgrA > UserA2. Tree B: MgrB > LeaderB > UserB1. */
let t: TestApp;
let org: Org;
let admin: ReturnType<typeof as>;
let mgrA: ReturnType<typeof as>;
let mgrB: ReturnType<typeof as>;
let leaderA: ReturnType<typeof as>;
let userA1: ReturnType<typeof as>;
let userA2: ReturnType<typeof as>;
let userB1: ReturnType<typeof as>;
let guest: ReturnType<typeof as>;

beforeAll(async () => {
  t = await makeApp();
  org = await seedOrg(t);
  for (const p of [org.userA1, org.userA2, org.userB1, org.leaderA, org.mgrA, org.mgrB]) await unlimit(t, p.id);
  admin = as(t, org.admin.id);
  mgrA = as(t, org.mgrA.id);
  mgrB = as(t, org.mgrB.id);
  leaderA = as(t, org.leaderA.id);
  userA1 = as(t, org.userA1.id);
  userA2 = as(t, org.userA2.id);
  userB1 = as(t, org.userB1.id);
  guest = as(t, org.guestData.id);
});
afterAll(async () => {
  await t.close();
});

type Home = { datahub_id: string | null; tables: { id: string; datahub_id: string; name: string; template_id: string | null; template_kind: string | null; template_scope: string | null; access: string }[] };

describe("datahub.deal.home", () => {
  let shared: { id: string; master_table_id: string };
  let personal: { id: string };
  it("lists template tables first (shared one from the Manager's datahub, own copy of a personal one), then the tables you made", async () => {
    shared = await mgrA("datahub.template.create", { name: "Home chung", kind: "shared", member_permission: "edit_data" });
    personal = await mgrA("datahub.template.create", { name: "Home riêng", kind: "personal" });
    const mine = await userA1("datahub.datahub.list", {});
    expect(mine.length).toBe(0);
    const home = (await userA1("datahub.deal.home", {})) as Home;
    expect(home.datahub_id).toBeTruthy();
    const names = home.tables.map((x) => x.name);
    expect(names).toEqual(expect.arrayContaining(["Home chung", "Home riêng"]));
    const s = home.tables.find((x) => x.name === "Home chung")!;
    expect(s.template_id).toBe(shared.id);
    expect(s.template_kind).toBe("shared");
    expect(s.template_scope).toBe("tree");
    expect(s.datahub_id).not.toBe(home.datahub_id);
    expect(home.tables.find((x) => x.name === "Home riêng")!.datahub_id).toBe(home.datahub_id);
    // A table of your own comes after every template table.
    await userA1("datahub.table.create", { datahub_id: home.datahub_id, name: "Bảng của tôi" });
    const again = (await userA1("datahub.deal.home", {})) as Home;
    const last = again.tables[again.tables.length - 1]!;
    expect(last.name).toBe("Bảng của tôi");
    expect(last.template_id).toBeNull();
    expect(again.tables.findIndex((x) => x.template_id === null)).toBe(again.tables.length - 1);
  });
  it("another tree, Admin and Guest do not see the template; the tables of a person's own deal datahub stay theirs", async () => {
    expect(((await userB1("datahub.deal.home", {})) as Home).tables.some((x) => x.name === "Home chung")).toBe(false);
    expect(((await userA2("datahub.deal.home", {})) as Home).tables.some((x) => x.name === "Bảng của tôi")).toBe(false);
    for (const who of [admin, guest]) expect(((await who("datahub.deal.home", {}).catch(() => ({ datahub_id: null, tables: [] }))) as Home).tables.some((x) => x.name === "Home chung")).toBe(false);
    expect(((await admin("datahub.deal.home", {}).catch(() => ({ datahub_id: null }))) as Home).datahub_id).toBeNull();
  });
});

describe("datahub.template.impact", () => {
  let tpl: { id: string };
  it("counts who a layer reaches: everyone, a role, a team", async () => {
    tpl = await mgrA("datahub.template.create", { name: "Ảnh hưởng", kind: "shared" });
    const all = await mgrA("datahub.template.impact", { template_id: tpl.id });
    expect(all.count).toBe(4); // the Manager gets a copy of the table too
    const users = await mgrA("datahub.template.impact", { template_id: tpl.id, layer: "role", layer_roles: ["user"] });
    expect(users.count).toBe(2);
    expect(users.names.length).toBe(2);
    const leaders = await mgrA("datahub.template.impact", { template_id: tpl.id, layer: "role", layer_roles: ["leader"] });
    expect(leaders.count).toBe(1);
    const team = await mgrA("datahub.template.impact", { template_id: tpl.id, layer: "team", team_leader_id: org.leaderA.id });
    expect(team.count).toBe(2);
  });
  it("needs layer_roles / team_leader_id for those layers; a member who cannot edit, another tree and Admin are refused", async () => {
    expect((await fails(mgrA("datahub.template.impact", { template_id: tpl.id, layer: "role" }))).code).toBe("validation_error");
    expect((await fails(mgrA("datahub.template.impact", { template_id: tpl.id, layer: "team" }))).code).toBe("validation_error");
    expect((await fails(userA1("datahub.template.impact", { template_id: tpl.id }))).code).toBe("forbidden");
    expect((await fails(leaderA("datahub.template.impact", { template_id: tpl.id }))).code).toBe("forbidden");
    expect((await fails(mgrB("datahub.template.impact", { template_id: tpl.id }))).code).toBe("not_found");
    expect((await fails(admin("datahub.template.impact", { template_id: tpl.id }))).code).toBeTruthy();
  });
  it("a Leader sees the impact once the table lets Leaders add team columns", async () => {
    await mgrA("datahub.template.update", { template_id: tpl.id, leader_can_add_columns: true });
    const team = await leaderA("datahub.template.impact", { template_id: tpl.id, layer: "team" });
    expect(team.count).toBe(2);
  });
});

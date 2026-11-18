import pg from "pg";
import { describe, expect, it } from "vitest";
import { runMigrations } from "../src/migrate";

/** Roles belong to the whole Postgres cluster: a test run must never change the password of the dev role `soe_app`. */
describe("runtime role name", () => {
  it("migrates with its own role and leaves the default role alone", async () => {
    const owner = new URL(process.env.TEST_OWNER_URL!);
    const adminUrl = new URL(owner);
    adminUrl.pathname = "/postgres";
    const probeUrl = new URL(owner);
    probeUrl.pathname = "/soe_hub_role_probe";
    let createdDefault = false;
    const admin = new pg.Client({ connectionString: adminUrl.toString() });
    await admin.connect();
    try {
      // Only create the default role when the machine has none (CI); never set a password on a real dev role.
      if (!(await admin.query("SELECT 1 FROM pg_roles WHERE rolname='soe_app'")).rowCount) {
        await admin.query("CREATE ROLE soe_app LOGIN PASSWORD 'dev-password-must-survive'");
        createdDefault = true;
      }
      const pw = async (r: string) => (await admin.query("SELECT rolpassword FROM pg_authid WHERE rolname = $1", [r])).rows[0]?.rolpassword as string | undefined;
      const before = await pw("soe_app");
      await admin.query("DROP DATABASE IF EXISTS soe_hub_role_probe WITH (FORCE)");
      await admin.query("CREATE DATABASE soe_hub_role_probe");
      await runMigrations({ url: probeUrl.toString(), appPassword: "probe-pass", appRole: "soe_app_probe" });
      expect(await pw("soe_app_probe")).toBeTruthy();
      expect(await pw("soe_app")).toBe(before);
      // The probe database grants belong to the probe role, not to soe_app.
      const probe = new pg.Client({ connectionString: probeUrl.toString() });
      await probe.connect();
      const g = await probe.query("SELECT has_table_privilege('soe_app_probe', 'users', 'SELECT') AS ok, has_table_privilege('soe_app_probe', 'audit_log', 'DELETE') AS del");
      await probe.end();
      expect(g.rows[0]).toEqual({ ok: true, del: false });
    } finally {
      await admin.query("DROP DATABASE IF EXISTS soe_hub_role_probe WITH (FORCE)");
      await admin.query("DROP ROLE IF EXISTS soe_app_probe");
      if (createdDefault) await admin.query("DROP ROLE IF EXISTS soe_app");
      await admin.end();
    }
  });
});

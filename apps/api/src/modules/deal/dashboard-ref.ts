import { sql } from "drizzle-orm";
import { z } from "zod";
import { defineQuery } from "../../core/registry";
import { DEAL_DASHBOARD_NAME } from "./default-dashboard";

/**
 * Which dashboard is the system dashboard "Deals" of the caller's tree (design module5 4.3): the one the `deal_metrics` tool reads, so the AI and the
 * screen show the same numbers. The dashboard lives in the datahub of the Manager's template tables: yours when you are that Manager, else the one shared to you.
 */
export const dealDashboardOperations = [
  defineQuery({
    name: "deal.dashboard",
    summary: "Mã dashboard hệ thống \"Deals\" của cây bạn (null nếu cây chưa có).",
    permission: "deal:deal:read",
    aiAllowed: true,
    input: z.object({}),
    output: z.object({ dashboard_id: z.uuid().nullable(), datahub_id: z.uuid().nullable(), name: z.string() }),
    http: { method: "GET", path: "/deal/dashboard" },
    handler: async (ctx) => {
      const me = ctx.actor.userId;
      const r = await ctx.db.execute(sql`SELECT d.id, d.datahub_id FROM mt_dashboards d JOIN dh_datahubs h ON h.id = d.datahub_id
        WHERE /*scope*/ d.name = ${DEAL_DASHBOARD_NAME} AND d.deleted_at IS NULL AND h.deleted_at IS NULL AND h.system_key = 'deal'
          AND (h.owner_id = ${me}::uuid OR EXISTS (SELECT 1 FROM dh_shares s WHERE s.datahub_id = h.id AND s.grantee_id = ${me}::uuid))
        ORDER BY (h.owner_id = ${me}::uuid) DESC, d.created_at LIMIT 1`);
      const row = r.rows[0] as { id: string; datahub_id: string } | undefined;
      return { dashboard_id: row?.id ?? null, datahub_id: row?.datahub_id ?? null, name: DEAL_DASHBOARD_NAME };
    },
  }),
];

import { sql } from "drizzle-orm";
import { businessDate, type Actor } from "@soe/shared";
import { enqueueOutbox, type Db } from "@soe/db";
import { NOTIFICATION_TYPES } from "../notification/catalog";
import { sendNotification, stableId } from "../notification/notify";
import { evaluatePlan, type Calc } from "./checkpoints";
import { addDays, dateOf, planFrom, type PlanRow } from "./shared";

/** The jobs of Onboarding (design module9 4 and 9): reminders and overdue, checkpoints that turned Đạt, the Sunday check of the week. All safe to run twice (source ids, notified markers). */

const OVERDUE_DAYS = 7; // an item overdue for longer is not announced (a plan that has been forgotten should not flood people)
const SYSTEM: Actor = { userId: "00000000-0000-0000-0000-000000000000", via: "worker", connectionId: null, automationId: null, sessionId: null, scopes: [], ip: null, userAgent: "soe-worker" };
const calc = (db: Db): Calc => ({ db, actor: SYSTEM });
const link = "/onboarding/theo-doi";

interface Occ { id: string; plan_id: string; item_id: string; due_at: string; name: string; staff_id: string; staff_name: string; leader_id: string | null; manager_id: string | null }

/** Who is told with the staff: the direct Leader, else the Manager of the tree (a person under the Manager directly has no Leader). */
const boss = (o: { leader_id: string | null; manager_id: string | null }): string[] => (o.leader_id ? [o.leader_id] : o.manager_id ? [o.manager_id] : []);

/** Every 5 minutes: an item reaching its reminder time and not ticked reminds the person; past its deadline it tells the person and the Leader. Once per occurrence (unique source id). */
export async function runOnboardingDue(db: Db, now = new Date()): Promise<{ reminded: number; overdue: number }> {
  const at = now.toISOString();
  const rows = (await db.execute(sql`/*scope:system*/ SELECT o.id, o.plan_id, o.item_id, o.due_at, i.name, p.staff_id, u.full_name AS staff_name, m.leader_id, m.manager_id
    FROM onb_occurrences o JOIN onb_items i ON i.id = o.item_id JOIN onb_plans p ON p.id = o.plan_id AND p.status = 'active'
    JOIN users u ON u.id = p.staff_id LEFT JOIN org_memberships m ON m.user_id = p.staff_id AND m.valid_to IS NULL
    WHERE o.done_at IS NULL AND o.due_at IS NOT NULL AND o.due_at > ${at}::timestamptz - make_interval(days => ${OVERDUE_DAYS})
      AND (o.due_at <= ${at}::timestamptz OR (i.remind_before_min IS NOT NULL AND o.due_at - make_interval(mins => i.remind_before_min) <= ${at}::timestamptz))`)).rows as unknown as Occ[];
  let reminded = 0;
  let overdueN = 0;
  for (const o of rows) {
    const due = new Date(o.due_at);
    const late = due <= now;
    const when = new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" }).format(due);
    const made = await sendNotification(db, {
      type: late ? NOTIFICATION_TYPES.onboardingOverdue : NOTIFICATION_TYPES.onboardingDue,
      recipients: late ? [o.staff_id, ...boss(o)] : [o.staff_id],
      object: { type: "onboarding_plan", id: o.plan_id },
      sourceEventId: stableId(late ? "onb.overdue" : "onb.remind", o.id),
      render: (r) => (late
        ? { title: r === o.staff_id ? "Việc đã quá hạn" : `${o.staff_name} có việc quá hạn`, body: r === o.staff_id ? `"${o.name}" hạn ${when} chưa xong.` : `${o.staff_name} chưa xong "${o.name}" (hạn ${when}).`, link, data: { plan_id: o.plan_id, occurrence_id: o.id } }
        : { title: "Sắp tới hạn", body: `"${o.name}" hạn ${when}, bạn chưa đánh dấu xong.`, link, data: { plan_id: o.plan_id, occurrence_id: o.id } }),
    });
    if (made === 0) continue;
    if (late) overdueN++;
    else reminded++;
    await enqueueOutbox(db, { event: "onboarding.item.due", aggregateType: "onboarding_plan", aggregateId: o.plan_id, payload: { plan_id: o.plan_id, occurrence_id: o.id, item_id: o.item_id, staff_id: o.staff_id, due_at: due.toISOString(), overdue: late } });
  }
  return { reminded, overdue: overdueN };
}

async function activePlans(db: Db): Promise<(PlanRow & { staffName: string; leaderId: string | null; managerId: string | null })[]> {
  const rows = (await db.execute(sql`/*scope:system*/ SELECT p.*, u.full_name AS staff_name, m.leader_id, m.manager_id FROM onb_plans p JOIN users u ON u.id = p.staff_id
    LEFT JOIN org_memberships m ON m.user_id = p.staff_id AND m.valid_to IS NULL WHERE p.status = 'active' AND p.staff_id IS NOT NULL AND p.start_date IS NOT NULL`)).rows as Record<string, unknown>[];
  return rows.map((r) => ({ ...planFrom(r), staffName: r.staff_name as string, leaderId: (r.leader_id as string | null) ?? null, managerId: (r.manager_id as string | null) ?? null }));
}

/** Every 10 minutes: a checkpoint of a running plan that is now Đạt (not told before) is marked and queued for the Leader's daily summary. Returns how many turned. */
export async function runCheckpointsPassed(db: Db): Promise<number> {
  let n = 0;
  for (const plan of await activePlans(db)) {
    const todo = await evaluatePlan(calc(db), plan, (c) => !c.passedNotifiedAt);
    for (const { cp, status } of todo) {
      if (status !== "passed" && status !== "passed_late") continue;
      const hit = await db.execute(sql`/*scope:system*/ UPDATE onb_checkpoints SET passed_notified_at = now() WHERE id = ${cp.id}::uuid AND passed_notified_at IS NULL RETURNING id`);
      if (!hit.rows.length) continue;
      n++;
      await enqueueOutbox(db, { event: "onboarding.checkpoint.passed", aggregateType: "onboarding_plan", aggregateId: plan.id, payload: { plan_id: plan.id, staff_id: plan.staffId, notify_id: plan.leaderId ?? plan.managerId, checkpoint_id: cp.id } });
    }
  }
  return n;
}

/** Sunday 20:00 (Vietnam time): a checkpoint of the week that ends today and is still not Đạt tells the person and the Leader. Once per checkpoint and week. */
export async function runWeekEnd(db: Db, now = new Date()): Promise<number> {
  const today = businessDate(now);
  let n = 0;
  for (const plan of await activePlans(db)) {
    const monday = addDays(today, -((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7));
    const weekNo = Math.round((new Date(`${monday}T00:00:00Z`).getTime() - new Date(`${plan.startDate}T00:00:00Z`).getTime()) / 604800000) + 1;
    if (weekNo < 1 || dateOf(plan.startDate!, weekNo, 1) !== monday) continue;
    for (const { cp, status } of await evaluatePlan(calc(db), plan, (c) => c.weekNo === weekNo && !c.isFinal)) {
      if (status === "passed" || status === "passed_late") continue;
      n += await sendNotification(db, {
        type: NOTIFICATION_TYPES.onboardingWeekMissed,
        recipients: [plan.staffId!, ...(plan.leaderId ?? plan.managerId ? [(plan.leaderId ?? plan.managerId)!] : [])],
        object: { type: "onboarding_plan", id: plan.id },
        sourceEventId: stableId("onb.weekmiss", cp.id, monday),
        render: (r) => ({ title: "Checkpoint tuần chưa đạt", body: r === plan.staffId ? `Checkpoint "${cp.name}" của tuần ${weekNo} chưa đạt.` : `${plan.staffName}: checkpoint "${cp.name}" của tuần ${weekNo} chưa đạt.`, link, data: { plan_id: plan.id, checkpoint_id: cp.id, week_no: weekNo } }),
      });
    }
  }
  return n;
}

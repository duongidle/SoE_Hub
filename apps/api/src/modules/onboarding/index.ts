import { registerOwnedTable } from "../../auth/query-guard";
export { onboardingOperations, onboardingEvents } from "./ops";
export { ensureAllSamplePlans, ensureSamplePlan, startSamplePlanLoop, SAMPLE_KEY } from "./sample";

for (const t of ["onb_plans", "onb_stages", "onb_weeks", "onb_items", "onb_occurrences", "onb_checkpoints"]) registerOwnedTable(t);

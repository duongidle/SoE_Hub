export * from "./types";
export * from "./ast";
export { parseFormula } from "./parser";
export { evaluate, scalarize } from "./evaluator";
export { NOT_FOUND, type EvalContext, type GroupPlan, type RowInfo, type FnDef } from "./context";
export { inferType } from "./infer";
export { collectDeps, validateCalls, findGroupable, type FormulaDeps, type GroupableCall, type GroupAgg, type Issue } from "./analyze";
export { toStoredFormula, toDisplayFormula, parseStored, type RefTarget, type StoreResult } from "./refs";
export { FUNCTION_CATALOG, type FunctionInfo } from "./catalog";
export { ALL_FUNCTIONS, getFunction, formatText } from "./functions";
export { buildMatcher, isPlainEquality, equalityKey } from "./criteria";
export * from "./dates";

/** Kept for packages/metrics (Stage 3), which only checks that the package is wired. */
export const FORMULA_PACKAGE_READY = true as const;

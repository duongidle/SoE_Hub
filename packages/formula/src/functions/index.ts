import type { FnDef } from "../context";
import { dateFns } from "./datetime";
import { logicFns, mathFns } from "./logic-math";
import { lookupFns, rowInfoFns } from "./lookup";
import { statFns } from "./stats";
import { textFns } from "./text";

export const ALL_FUNCTIONS: FnDef[] = [...logicFns, ...mathFns, ...statFns, ...textFns, ...dateFns, ...lookupFns, ...rowInfoFns];

const byName = new Map<string, FnDef>(ALL_FUNCTIONS.map((f) => [f.name, f]));

export function getFunction(name: string): FnDef | undefined {
  return byName.get(name.toUpperCase());
}

export { formatText } from "./text";

import { ALL_FUNCTIONS } from "./functions";

export interface FunctionInfo {
  name: string;
  group: string;
  syntax: string;
  description: string;
  example: string;
  example_result: string;
  min_args: number;
  max_args: number;
  volatile: "today" | "now" | null;
}

/** Catalogue of every function for the editor (suggestions, syntax hint) and the API. */
export const FUNCTION_CATALOG: FunctionInfo[] = ALL_FUNCTIONS.map((f) => ({
  name: f.name,
  group: f.group,
  syntax: f.syntax,
  description: f.description,
  example: f.example,
  example_result: f.exampleResult,
  min_args: f.min,
  max_args: f.max,
  volatile: f.volatile ?? null,
})).sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name));

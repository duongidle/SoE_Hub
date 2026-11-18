import type { Node } from "./ast";
import { getFunction } from "./functions";
import type { FType } from "./types";

const isDateLike = (t: FType) => t === "date" || t === "datetime";

/** Static result type of a parsed formula. `typeOfRef` gives the type of a cell, or the element type of a column. */
export function inferType(n: Node, typeOfRef: (n: Node) => FType): FType {
  const go = (x: Node): FType => inferType(x, typeOfRef);
  switch (n.t) {
    case "num":
      return "number";
    case "str":
      return n.v === "" ? "blank" : "text";
    case "bool":
      return "boolean";
    case "err":
    case "empty":
      return "unknown";
    case "ref":
    case "key":
      return typeOfRef(n);
    case "un":
    case "pct":
      return "number";
    case "bin": {
      if (n.op === "&") return "text";
      if (["=", "<>", "<", "<=", ">", ">="].includes(n.op)) return "boolean";
      const l = go(n.l);
      const r = go(n.r);
      if (n.op === "+") {
        if (isDateLike(l) && !isDateLike(r)) return l;
        if (isDateLike(r) && !isDateLike(l)) return r;
      }
      if (n.op === "-" && isDateLike(l) && !isDateLike(r) && r !== "unknown") return l;
      return "number";
    }
    case "call": {
      const fn = getFunction(n.name);
      if (!fn) return "unknown";
      const argTypes = n.args.map(go);
      return typeof fn.returns === "function" ? fn.returns(argTypes) : fn.returns;
    }
  }
}

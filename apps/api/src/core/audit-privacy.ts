/**
 * Private data in the audit log (design module1 section 10): for rows of private data (datahub rows, Module 2) the
 * Admin's audit log records the action, the object and the names of changed fields, but never the values.
 * Old -> new values stay in row_history, which only the owner and people it is shared with can read.
 *
 * Modules that own private data call `registerPrivateAuditTarget("datahub_row")`. Masking runs when the audit row is
 * written (so values never reach the table) and again when the log is read (defence in depth).
 */
const privateTargets = new Set<string>();

export function registerPrivateAuditTarget(type: string): void {
  privateTargets.add(type);
}

export function isPrivateAuditTarget(type: string | null | undefined): boolean {
  return !!type && privateTargets.has(type);
}

const VALUE_KEYS = new Set(["old", "new", "value", "values", "before", "after", "row", "data", "current", "samples"]);

function strip(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(strip);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) {
      if (VALUE_KEYS.has(k)) continue;
      out[k] = strip(x);
    }
    return out;
  }
  return v;
}

/** Removes values (keeps field names) from audit details of private targets. Other targets are returned unchanged. */
export function maskAuditDetails(type: string | null | undefined, details: unknown): unknown {
  if (!isPrivateAuditTarget(type) || details === undefined || details === null) return details;
  return { ...((strip(details) as object) ?? {}), values_hidden: true };
}

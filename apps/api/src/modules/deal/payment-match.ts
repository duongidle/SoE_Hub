/**
 * Fixed scoring of "which instalment does this money pay" (design module4 7.5). A pure function: the server gathers the facts, this ranks them. No AI.
 * Weights are constants here, in one place, so a change after the real transfer notices are seen is one edit.
 */
export interface MatchInput {
  amount?: number;
  payer_name?: string;
  account_no?: string;
  tax_code?: string;
  content?: string;
  received_on?: string;
}

export interface PaymentFacts {
  id: string;
  dealId: string | null;
  dealName: string | null;
  legalEntity: string | null;
  taxCode: string | null;
  contractNo: string | null;
  seq: number | null;
  planned: number | null;
  due: string | null;
}

/** Deals that an earlier, already matched transfer from the same account / payer paid (the "memory", read from the Tiền về table). */
export interface MatchMemory {
  accountDeals: Set<string>;
  payerDeals: Set<string>;
}

export interface Candidate {
  payment_id: string;
  deal_id: string | null;
  deal_name: string | null;
  seq: number | null;
  planned: number | null;
  due: string | null;
  score: number;
  /** Safe for an AI to confirm alone: a memory or tax-code hit AND the amount fits (module4 7.5). */
  strong: boolean;
  reasons: string[];
}

export const MATCH_WEIGHTS = { account: 50, payer: 40, taxCode: 40, contractNo: 30, nameHigh: 25, nameLow: 10, amount: 30, dueNear: 10, dueFar: 5 } as const;
export const VAT_RATES = [0, 0.05, 0.08, 0.1] as const;
const NOISE = new Set(["cong", "ty", "tnhh", "cp", "co", "phan", "mtv", "tm", "dv", "sx", "jsc", "ltd", "company", "corp", "corporation", "limited", "joint", "stock", "chi", "nhanh", "van", "phong", "dai", "dien", "thanh", "toan", "ck", "chuyen", "khoan"]);

/** Lower case, no accents, letters and digits only. */
export function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
const nameTokens = (s: string): string[] => fold(s).split(" ").filter((t) => t && !NOISE.has(t));
const digits = (s: string): string => s.replace(/\D+/g, "");

/** Share of the tokens of the shorter name that the other name has. 0 when a name has no token. */
export function nameSimilarity(a: string, b: string): number {
  const ta = new Set(nameTokens(a));
  const tb = new Set(nameTokens(b));
  if (!ta.size || !tb.size) return 0;
  let hit = 0;
  for (const t of ta) if (tb.has(t)) hit++;
  return hit / Math.min(ta.size, tb.size);
}

const fmt = (n: number): string => (Math.abs(n) >= 1e6 ? `${Math.round((n / 1e6) * 1000) / 1000}tr` : String(Math.round(n * 100) / 100));
const day = (s: string): number => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 86_400_000;

export function scoreCandidates(input: MatchInput, facts: PaymentFacts[], memory: MatchMemory, o: { tolerance?: number; limit?: number } = {}): Candidate[] {
  const tol = o.tolerance ?? 0.001;
  const out: Candidate[] = [];
  const content = input.content ? fold(input.content) : "";
  const tax = input.tax_code ? digits(input.tax_code) : "";
  for (const f of facts) {
    let score = 0;
    const reasons: string[] = [];
    let anchor = false;
    if (f.dealId && memory.accountDeals.has(f.dealId)) {
      score += MATCH_WEIGHTS.account;
      anchor = true;
      reasons.push("khớp số tài khoản đã ghép trước");
    }
    if (f.dealId && memory.payerDeals.has(f.dealId)) {
      score += MATCH_WEIGHTS.payer;
      anchor = true;
      reasons.push("khớp tên người trả đã ghép trước");
    }
    if (tax && f.taxCode && digits(f.taxCode) === tax) {
      score += MATCH_WEIGHTS.taxCode;
      anchor = true;
      reasons.push("khớp mã số thuế");
    }
    if (content && f.contractNo && content.includes(fold(f.contractNo)) && fold(f.contractNo).length >= 3) {
      score += MATCH_WEIGHTS.contractNo;
      reasons.push(`nội dung có số hợp đồng ${f.contractNo}`);
    }
    if (input.payer_name) {
      const sim = Math.max(f.legalEntity ? nameSimilarity(input.payer_name, f.legalEntity) : 0, f.dealName ? nameSimilarity(input.payer_name, f.dealName) : 0);
      if (sim >= 0.6) {
        score += MATCH_WEIGHTS.nameHigh;
        reasons.push("tên đơn vị trả gần giống pháp nhân hoặc tên công ty của deal");
      } else if (sim >= 0.3) {
        score += MATCH_WEIGHTS.nameLow;
        reasons.push("tên đơn vị trả hơi giống pháp nhân hoặc tên công ty của deal");
      }
    }
    let amountFits = false;
    if (input.amount !== undefined && f.planned) {
      for (const rate of VAT_RATES) {
        const expected = f.planned * (1 + rate);
        if (Math.abs(input.amount - expected) <= Math.max(1, tol * expected)) {
          amountFits = true;
          score += MATCH_WEIGHTS.amount;
          reasons.push(rate === 0 ? `${fmt(input.amount)} bằng số tiền đợt` : `${fmt(input.amount)} = ${fmt(f.planned)} + VAT ${Math.round(rate * 100)}%`);
          break;
        }
      }
    }
    if (input.received_on && f.due) {
      const diff = day(f.due) - day(input.received_on);
      if (Math.abs(diff) <= 7) {
        score += MATCH_WEIGHTS.dueNear;
        reasons.push(diff >= 0 ? `hạn còn ${diff} ngày` : `quá hạn ${-diff} ngày`);
      } else if (Math.abs(diff) <= 30) score += MATCH_WEIGHTS.dueFar;
    }
    if (score <= 0) continue;
    out.push({ payment_id: f.id, deal_id: f.dealId, deal_name: f.dealName, seq: f.seq, planned: f.planned, due: f.due, score, strong: anchor && amountFits, reasons });
  }
  out.sort((a, b) => b.score - a.score || (a.due ?? "9999").localeCompare(b.due ?? "9999"));
  return out.slice(0, o.limit ?? 10);
}

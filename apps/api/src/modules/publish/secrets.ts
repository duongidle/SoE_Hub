/** Strings that look like keys, tokens or private keys (design module8 3.4, 4.2). Shared by every post kind. */
const PATTERNS: { name: string; re: RegExp }[] = [
  { name: "sk-", re: /\bsk-[A-Za-z0-9_-]{20,}/ },
  { name: "AKIA", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "ghp_", re: /\bghp_[A-Za-z0-9]{20,}/ },
  { name: "xox", re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/ },
  { name: "soe_pat_", re: /\bsoe_pat_[A-Za-z0-9_-]{10,}/ },
  { name: "private key", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
];

/** The kinds of secret found in the text (never the secret itself). */
export function findSecrets(text: string): string[] {
  return PATTERNS.filter((p) => p.re.test(text)).map((p) => p.name);
}

const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/;
const PHONE_RE = /(?<![\d.])(?:\+?84|0)(?:[\s.-]?\d){8,10}(?!\d)/;
export const hasEmail = (t: string): boolean => EMAIL_RE.test(t);
export const hasPhone = (t: string): boolean => PHONE_RE.test(t);

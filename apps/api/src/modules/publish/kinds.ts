import { AppError } from "@soe/shared";
import type { PostKind } from "./types";

const kinds = new Map<string, PostKind<never>>();

export function registerKind<C>(k: PostKind<C>): void {
  kinds.set(k.kind, k as unknown as PostKind<never>);
}
export function kindOf(kind: string): PostKind {
  const k = kinds.get(kind);
  if (!k) throw new AppError("not_found", "Không có loại bài này.", { kind });
  return k as unknown as PostKind;
}
export const kindNames = (): string[] => [...kinds.keys()];

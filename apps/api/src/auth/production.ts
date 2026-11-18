import type { Actor } from "@soe/shared";
import type { ActorResolver, AuthDecision, Authorizer } from "../core/types";

/**
 * Production behaviour until Stage 1 lands: nobody can be identified, so every operation that needs an
 * actor is refused (`unauthenticated`). Public operations (`permission: null`) still work, e.g. `/health`.
 */
export class NoActorResolver implements ActorResolver {
  resolve(): Actor | null {
    return null;
  }
}

/** Safety net: even if an actor somehow exists, nothing is allowed until the real engine exists. */
export class DenyAllAuthorizer implements Authorizer {
  authorize(): AuthDecision {
    return { allowed: false, reason: "Hệ thống phân quyền chưa được cài (Stage 1)." };
  }
}

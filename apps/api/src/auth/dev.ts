import { ActorSchema, HEADERS, type Actor } from "@soe/shared";
import type { ActorResolver, AuthDecision, Authorizer, AuthTarget, RequestInfo } from "../core/types";

/**
 * =====================================================================================================
 *  TEMPORARY, DEVELOPMENT ONLY.  Replaced by Module 1 (Stage 1).
 *
 *  Stage 0 has no users, sessions or permission rules. For local work and tests only, the actor comes from
 *  the `X-Dev-Actor` header (a user uuid; default `DEV_ACTOR_ID`) and optional `X-Dev-Scopes` (comma list).
 *  This file is wired in only when NODE_ENV !== "production" (see `auth/index.ts`).
 *  It must never be reachable in production: there the resolver returns no actor and every call that
 *  needs an actor is refused.
 * =====================================================================================================
 */
export class DevActorResolver implements ActorResolver {
  constructor(private readonly defaultActorId: string) {}

  resolve(req: RequestInfo): Actor | null {
    const raw = req.headers[HEADERS.devActor];
    const userId = (Array.isArray(raw) ? raw[0] : raw) ?? this.defaultActorId;
    const scopesRaw = req.headers[HEADERS.devScopes];
    const scopesStr = Array.isArray(scopesRaw) ? scopesRaw[0] : scopesRaw;
    const parsed = ActorSchema.safeParse({
      userId,
      via: "api",
      scopes: scopesStr ? scopesStr.split(",").map((s) => s.trim()).filter(Boolean) : [],
      ip: req.ip,
      userAgent: req.userAgent,
    });
    return parsed.success ? parsed.data : null;
  }
}

/**
 * Dev authorizer: an actor with no scopes may do anything; an actor with scopes may only use permissions
 * listed in its scopes (`*` = all). The scopes header lets tests exercise the "denied" path.
 */
export class DevAuthorizer implements Authorizer {
  authorize(actor: Actor, target: AuthTarget): AuthDecision {
    if (actor.scopes.length === 0 || actor.scopes.includes("*") || actor.scopes.includes(target.permission)) {
      return { allowed: true };
    }
    return { allowed: false, reason: `Thiếu quyền "${target.permission}".` };
  }
}

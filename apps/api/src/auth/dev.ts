import { ActorSchema, HEADERS, type Actor } from "@soe/shared";
import type { ActorResolver, RequestInfo } from "../core/types";

/**
 * =====================================================================================================
 *  TESTS ONLY (NODE_ENV=test). Never active in development or production (see `auth/index.ts`).
 *
 *  Lets a test act as a user with the `X-Dev-Actor` header (a users.id) instead of logging in. The user must exist
 *  and is checked by the REAL authorizer (roles, status). `X-Dev-Scopes` behaves like token scopes (intersection),
 *  to exercise the denied path. Requests without the header go to the real resolver (cookie / bearer).
 * =====================================================================================================
 */
export class TestActorResolver implements ActorResolver {
  constructor(private readonly real: ActorResolver) {}

  async resolve(req: RequestInfo): Promise<Actor | null> {
    const raw = req.headers[HEADERS.devActor];
    const userId = Array.isArray(raw) ? raw[0] : raw;
    if (!userId) return this.real.resolve(req);
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

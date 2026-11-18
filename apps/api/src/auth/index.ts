import type { Db } from "@soe/db";
import type { Config } from "../config";
import type { ActorResolver, Authorizer } from "../core/types";
import { PrincipalLoader, RoleAuthorizer } from "./access";
import { TestActorResolver } from "./dev";
import { SessionTokenResolver } from "./sessions";

export interface AuthKit {
  resolver: ActorResolver;
  authorizer: Authorizer;
  principals: PrincipalLoader;
  /** `real` everywhere; `test` adds the X-Dev-Actor header on top of the real resolver (NODE_ENV=test only). */
  mode: "real" | "test";
}

/** The one place that decides which auth implementation runs. */
export function createAuthKit(config: Config, db: Db): AuthKit {
  const principals = new PrincipalLoader(db);
  const authorizer = new RoleAuthorizer(principals);
  const real = new SessionTokenResolver(db, config);
  if (config.devAuthEnabled && config.NODE_ENV === "test" && !config.isProduction) {
    return { resolver: new TestActorResolver(real), authorizer, principals, mode: "test" };
  }
  return { resolver: real, authorizer, principals, mode: "real" };
}

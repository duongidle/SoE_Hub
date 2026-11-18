import type { Config } from "../config";
import type { ActorResolver, Authorizer } from "../core/types";
import { DevActorResolver, DevAuthorizer } from "./dev";
import { DenyAllAuthorizer, NoActorResolver } from "./production";

export interface AuthKit {
  resolver: ActorResolver;
  authorizer: Authorizer;
  mode: "dev" | "locked";
}

/** The one place that decides which auth implementation runs. Stage 1 replaces both branches. */
export function createAuthKit(config: Pick<Config, "isProduction" | "devAuthEnabled" | "DEV_ACTOR_ID">): AuthKit {
  if (!config.isProduction && config.devAuthEnabled) {
    return { resolver: new DevActorResolver(config.DEV_ACTOR_ID), authorizer: new DevAuthorizer(), mode: "dev" };
  }
  return { resolver: new NoActorResolver(), authorizer: new DenyAllAuthorizer(), mode: "locked" };
}

-- Stage 12D-1: per-person preferences (pinned dashboard tabs, recently opened items).
CREATE TABLE "user_prefs" (
  "user_id" uuid NOT NULL REFERENCES "users"("id"),
  "key" text NOT NULL,
  "value" jsonb NOT NULL,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("user_id", "key")
);

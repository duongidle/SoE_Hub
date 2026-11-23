-- The datahub the system builds for the sample onboarding plan is renamed "Onboarding" (Dương, 23/11/2026), level with "Quản lý Deal". A person who already has a datahub of that name is skipped (names are unique per owner).
UPDATE "dh_datahubs" d SET "name" = 'Onboarding' WHERE d."quota_exempt" AND d."name" = 'Onboarding mẫu' AND d."deleted_at" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "dh_datahubs" x WHERE x."owner_id" = d."owner_id" AND x."name_norm" = 'onboarding' AND x."deleted_at" IS NULL);

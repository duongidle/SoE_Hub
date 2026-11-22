-- Module 9 (Stage 9C2): a datahub the system builds for the user (the sample onboarding plan) is not counted in the datahub limit.
ALTER TABLE "dh_datahubs" ADD COLUMN "quota_exempt" boolean DEFAULT false NOT NULL;

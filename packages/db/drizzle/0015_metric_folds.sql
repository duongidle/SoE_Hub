-- Shared folds of the metric engine (design module4 decisions 4.1b): a table joined by key is folded once per key (aggregated per normalised key)
-- and the fold is the same for every reader, so the api keeps it in a table and every reader's statement joins it. The runtime role owns
-- this schema (like `pgboss`) and creates and drops the tables itself; a fold holds only values of a joined table whose rows every reader of that
-- table may see (never a table narrowed by the split lock or one with per-reader values).
CREATE SCHEMA IF NOT EXISTS mfold AUTHORIZATION soe_app;

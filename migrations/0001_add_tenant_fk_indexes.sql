-- Adds indexes on tenant/FK columns that were previously unindexed, causing
-- sequential scans on the hottest lookup paths (repos-by-org, prds/releases/
-- files-by-repo, jobs-by-repo, org-membership-by-org).
--
-- This project has no drizzle-kit migration history (schema.ts has been
-- applied via `drizzle-kit push` directly, not `generate`/`migrate`), so
-- this is a hand-written, idempotent, non-locking migration rather than a
-- drizzle-kit-generated one - run it directly against the database:
--
--   psql "$DATABASE_URL" -f migrations/0001_add_tenant_fk_indexes.sql
--
-- CREATE INDEX CONCURRENTLY cannot run inside a transaction block, so this
-- must be executed statement-by-statement (psql does this by default) - do
-- not wrap it in BEGIN/COMMIT. Names match what `drizzle-kit generate`
-- would produce from the index() calls in src/shared/schema.ts, so a future
-- `drizzle-kit push` will recognize these as already applied.

CREATE INDEX CONCURRENTLY IF NOT EXISTS "github_repos_organization_id_idx"
  ON "github_repos" USING btree ("organization_id");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "prds_repo_public_id_branch_idx"
  ON "prds" USING btree ("repo_public_id", "branch");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "releases_repo_public_id_branch_idx"
  ON "releases" USING btree ("repo_public_id", "branch");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "repo_files_repo_public_id_branch_idx"
  ON "repo_files" USING btree ("repo_public_id", "branch");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "enqueued_tasks_repo_public_id_branch_idx"
  ON "enqueued_tasks" USING btree ("repo_public_id", "branch");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "enqueued_tasks_organization_id_idx"
  ON "enqueued_tasks" USING btree ("organization_id");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "user_organizations_organization_id_idx"
  ON "user_organizations" USING btree ("organization_id");

-- Migration: Add public_id columns for secure external identifiers
-- This migration adds non-enumerable public IDs to entities exposed via the API

-- Add public_id column to organizations table
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS public_id TEXT;

-- Add public_id column to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS public_id TEXT;

-- Add public_id column to prds table
ALTER TABLE prds ADD COLUMN IF NOT EXISTS public_id TEXT;

-- Add public_id column to github_repos table
ALTER TABLE github_repos ADD COLUMN IF NOT EXISTS public_id TEXT;

-- Generate public IDs for existing records using a combination of prefix and random string
-- Using gen_random_uuid() and converting to a shorter format

-- Update existing organizations with public IDs
UPDATE organizations
SET public_id = 'org_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)
WHERE public_id IS NULL;

-- Update existing users with public IDs
UPDATE users
SET public_id = 'usr_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)
WHERE public_id IS NULL;

-- Update existing prds with public IDs
UPDATE prds
SET public_id = 'prd_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)
WHERE public_id IS NULL;

-- Update existing github_repos with public IDs
UPDATE github_repos
SET public_id = 'repo_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)
WHERE public_id IS NULL;

-- Now add NOT NULL constraint after populating existing records
ALTER TABLE organizations ALTER COLUMN public_id SET NOT NULL;
ALTER TABLE users ALTER COLUMN public_id SET NOT NULL;
ALTER TABLE prds ALTER COLUMN public_id SET NOT NULL;
ALTER TABLE github_repos ALTER COLUMN public_id SET NOT NULL;

-- Add unique indexes for public_id columns
CREATE UNIQUE INDEX IF NOT EXISTS idx_organizations_public_id ON organizations(public_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_public_id ON users(public_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_prds_public_id ON prds(public_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_github_repos_public_id ON github_repos(public_id);

-- Add comments for documentation
COMMENT ON COLUMN organizations.public_id IS 'Non-enumerable public identifier for API access. Format: org_xxxxxxxxxxxx';
COMMENT ON COLUMN users.public_id IS 'Non-enumerable public identifier for API access. Format: usr_xxxxxxxxxxxx';
COMMENT ON COLUMN prds.public_id IS 'Non-enumerable public identifier for API access. Format: prd_xxxxxxxxxxxx';
COMMENT ON COLUMN github_repos.public_id IS 'Non-enumerable public identifier for API access. Format: repo_xxxxxxxxxxxx';

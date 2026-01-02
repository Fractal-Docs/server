# Security Migration: Public IDs and Authorization

This document describes the security improvements made to prevent ID enumeration attacks and enforce proper authorization.

## Overview

The migration addresses two key security concerns:

1. **Enumeration Attacks**: Sequential integer IDs exposed via the API allow attackers to guess valid IDs
2. **Missing Authorization**: Some endpoints didn't verify the user had permission to access resources

**Important**: This migration removes all backward compatibility. All routes now use `publicId` exclusively - numeric IDs and GitHub repoIds are not supported in URLs.

## Changes Made

### 1. Public IDs

Added non-enumerable `publicId` columns to entities exposed via the API:

- **organizations**: `org_xxxxxxxxxxxx`
- **users**: `usr_xxxxxxxxxxxx`
- **prds**: `prd_xxxxxxxxxxxx`
- **repositories**: `repo_xxxxxxxxxxxx`
- **releases**: `rel_xxxxxxxxxxxx`
- **roles**: `role_xxxxxxxxxxxx`

#### Schema Changes

New columns added in `src/shared/schema.ts`:

```typescript
// organizations table
publicId: text("public_id").notNull().unique()

// users table
publicId: text("public_id").notNull().unique()

// prds table
publicId: text("public_id").notNull().unique()

// github_repos table
publicId: text("public_id").notNull().unique()

// releases table
publicId: text("public_id").notNull().unique()

// roles table
publicId: text("public_id").notNull().unique()
```

#### New Utility Module

`src/lib/public-ids.ts` provides:

- `generatePublicId()` - Generate a new public ID
- `generateShortPublicId()` - Generate a shorter public ID
- `isValidPublicId()` - Validate a public ID format
- `hasValidPrefix()` - Check if ID has expected prefix (e.g., "org", "usr", "prd")
- `publicIdGenerators` - Prefixed ID generators for each entity type (org, usr, prd, repo, rel, role)

### 2. Authorization Middleware

New authorization module at `src/lib/routes/authorization.ts`:

#### Middleware Functions

| Function | Description |
|----------|-------------|
| `requireAuth()` | Validates JWT and attaches user to request |
| `requireOrgMembership(options)` | Verifies user is a member of the organization (by publicId) |
| `requireOrgMember(paramName)` | Convenience: requires member role or higher |
| `requireOrgAdmin(paramName)` | Convenience: requires admin role or higher |
| `requireOrgOwner(paramName)` | Convenience: requires owner role |

#### Helper Functions

| Function | Description |
|----------|-------------|
| `verifyResourceOwnership()` | Verifies a resource belongs to the organization |
| `canModifyUser()` | Checks if current user can modify another user |
| `authorizedHandler()` | Async route handler with proper typing |

#### Request Types

```typescript
interface AuthorizedRequest extends Request {
  currentUser: User
  userSub: string
}

interface AuthorizedOrgRequest extends AuthorizedRequest {
  organization: Organization
  orgId: number           // Internal ID (for DB queries)
  orgPublicId: string     // Public ID (for responses)
  userRole: "owner" | "admin" | "member"
}
```

### 3. Route URL Changes

All routes now use `org_public_id` instead of numeric organization IDs:

#### Organization Routes
| Old Route | New Route |
|-----------|-----------|
| `GET /api/organization/:id` | `GET /api/organization/:org_public_id` |
| `PUT /api/organization/:org_id` | `PUT /api/organization/:org_public_id` |
| `DELETE /api/organization/:id` | `DELETE /api/organization/:org_public_id` |
| `GET /api/organization/:id/users` | `GET /api/organization/:org_public_id/users` |
| `POST /api/organization/:id/users` | `POST /api/organization/:org_public_id/users` |
| `DELETE /api/organization/:id/users/:userId` | `DELETE /api/organization/:org_public_id/users/:user_public_id` |
| `PATCH /api/organization/:id/users/:userId` | `PATCH /api/organization/:org_public_id/users/:user_public_id` |
| `POST /api/organization/:id/invite` | `POST /api/organization/:org_public_id/invite` |

#### PRD Routes
| Old Route | New Route |
|-----------|-----------|
| `GET /api/organization/:org_id/prds` | `GET /api/organization/:org_public_id/prds` |
| `GET /api/organization/:org_id/prds/:prd_id` | `GET /api/organization/:org_public_id/prds/:prd_id` |
| `POST /api/organization/:org_id/prds` | `POST /api/organization/:org_public_id/prds` |
| `PATCH /api/organization/:org_id/prds/:prd_id` | `PATCH /api/organization/:org_public_id/prds/:prd_id` |
| `DELETE /api/organization/:org_id/prds/:prd_id` | `DELETE /api/organization/:org_public_id/prds/:prd_id` |

Note: `prd_id` must also be a publicId (e.g., `prd_xxxxxxxxxxxx`)

#### Repository/Code Routes
| Old Route | New Route |
|-----------|-----------|
| `GET /api/organization/:org_id/repos` | `GET /api/organization/:org_public_id/repos` |
| `GET /api/organization/:org_id/repos/:repo_id` | `GET /api/organization/:org_public_id/repos/:repo_public_id` |
| `DELETE /api/organization/:org_id/repos/:repo_id` | `DELETE /api/organization/:org_public_id/repos/:repo_public_id` |
| `PATCH /api/organization/:org_id/repos/:repo_id` | `PATCH /api/organization/:org_public_id/repos/:repo_public_id` |
| `GET /api/organization/:org_id/repos/:repo_id/embeddings` | `GET /api/organization/:org_public_id/repos/:repo_public_id/embeddings` |
| `POST /api/organization/:org_id/repos/:repo_id/analyze` | `POST /api/organization/:org_public_id/repos/:repo_public_id/analyze` |
| `POST /api/organization/:org_id/repos/:repo_id/generate-cfg` | `POST /api/organization/:org_public_id/repos/:repo_public_id/generate-cfg` |
| `GET /api/organization/:org_id/repos/:repo_id/cfg` | `GET /api/organization/:org_public_id/repos/:repo_public_id/cfg` |
| `GET /api/organization/:org_id/repos/:repo_id/releases/check` | `GET /api/organization/:org_public_id/repos/:repo_public_id/releases/check` |

Note: `repo_public_id` must be in format `repo_xxxxxxxxxxxx`. The old GitHub `repoId` is no longer accepted in URLs.

#### Document Routes
| Old Route | New Route |
|-----------|-----------|
| `POST /api/organization/:org_id/repos/:repo_id/generate` | `POST /api/organization/:org_public_id/repos/:repo_public_id/generate` |
| `POST /api/organization/:org_id/repos/:repo_id/compare` | `POST /api/organization/:org_public_id/repos/:repo_public_id/compare` |
| `GET /api/organization/:org_id/repos/:repo_id/docs` | `GET /api/organization/:org_public_id/repos/:repo_public_id/docs` |
| `GET /api/organization/:org_id/repos/:repo_id/docs_status` | `GET /api/organization/:org_public_id/repos/:repo_public_id/docs_status` |
| `GET /api/organization/:org_id/repos/:repo_id/docs_status/:job_id` | `GET /api/organization/:org_public_id/repos/:repo_public_id/docs_status/:job_id` |
| `GET /api/organization/:org_id/recent-documents` | `GET /api/organization/:org_public_id/recent-documents` |

#### GitHub Routes
| Old Route | New Route |
|-----------|-----------|
| `GET /api/github/repos/:repo_id/files` | `GET /api/github/repos/:repo_public_id/files` |
| `GET /api/github/repos/:repo_id/branches` | `GET /api/github/repos/:repo_public_id/branches` |

#### Release Routes
| Old Route | New Route |
|-----------|-----------|
| `GET /api/organization/:org_public_id/releases/:id` | `GET /api/organization/:org_public_id/releases/:release_public_id` |
| `DELETE /api/organization/:org_public_id/releases/:id` | `DELETE /api/organization/:org_public_id/releases/:release_public_id` |
| `GET /api/organization/:org_public_id/releases/:id/role-docs` | `GET /api/organization/:org_public_id/releases/:release_public_id/role-docs` |
| `POST /api/organization/:org_public_id/releases/:release_id/role-docs` | `POST /api/organization/:org_public_id/releases/:release_public_id/role-docs` |

Note: `release_public_id` must be in format `rel_xxxxxxxxxxxx`. All release routes use `org_public_id` and releases are created with `repoPublicId` in the request body (not `repoId`).

#### Role Routes
All role routes use `org_public_id`. Roles are identified by `role_type` in routes (not by publicId), but role records contain a `publicId` field (format: `role_xxxxxxxxxxxx`) that is used internally and in role documents.

### 4. Authorization Requirements

| Route Pattern | Required Role |
|---------------|---------------|
| `GET /api/organizations` | Authenticated |
| `GET /api/organization/:org_public_id` | Member |
| `POST /api/organizations` | Authenticated (creator becomes owner) |
| `PUT /api/organization/:org_public_id` | Admin |
| `DELETE /api/organization/:org_public_id` | Owner |
| `GET /api/organization/:org_public_id/users` | Member |
| `POST /api/organization/:org_public_id/users` | Admin |
| `DELETE /api/organization/:org_public_id/users/:user_public_id` | Admin (or self) |
| `PATCH /api/organization/:org_public_id/users/:user_public_id` | Owner |
| `POST /api/organization/:org_public_id/invite` | Admin |
| PRD read routes | Member |
| PRD create/update routes | Member |
| PRD delete routes | Admin |
| Release read routes | Member |
| Release create routes | Member |
| Release delete routes | Admin |
| Repo read routes | Member |
| Repo delete/update routes | Admin |
| Document routes | Member |
| Role read routes | Member |
| Role update routes | Admin |

### 5. Storage Updates

New methods added to `IStorage` interface and `DatabaseStorage`:

```typescript
// PRD operations
getPrdByPublicId(publicId: string): Promise<Prd | undefined>
updatePrdByPublicId(publicId: string, prd: InsertPrd): Promise<Prd>
deletePrdByPublicId(publicId: string): Promise<void>

// User operations
getUserById(id: number): Promise<User | undefined>
getUserByPublicId(publicId: string): Promise<User | undefined>

// Organization operations
getOrganizationByPublicId(publicId: string): Promise<Organization | undefined>

// Repository operations
getRepoByPublicId(publicId: string): Promise<GithubRepo | undefined>
getRepoByGithubId(githubRepoId: string): Promise<GithubRepo | undefined>
updateRepoByPublicId(publicId: string, repo: Partial<InsertGithubRepo>): Promise<GithubRepo>
deleteRepoByPublicId(publicId: string): Promise<void[]>

// Release operations
getRelease(publicId: string): Promise<Release | undefined>
getReleaseByBranch(repoId: string, branch: string): Promise<Release | undefined>
createRelease(release: Omit<InsertRelease, "publicId">): Promise<Release>
updateRelease(publicId: string, release: Partial<InsertRelease>): Promise<Release>
deleteRelease(publicId: string): Promise<void>

// Role operations
getRole(publicId: string): Promise<RoleRecord | undefined>
createRole(role: Omit<InsertRole, "publicId">): Promise<RoleRecord>
updateRole(publicId: string, role: Partial<InsertRole>): Promise<RoleRecord>
deleteRole(publicId: string): Promise<void>

// Role document operations
getRoleDocsForRelease(releasePublicId: string): Promise<RoleDocument[]>
deleteRoleDocsForRelease(releasePublicId: string): Promise<void>
```

Public IDs are automatically generated when creating new records.

Note: `getRepoByGithubId` is used internally when looking up repos by the external GitHub ID (stored in `repoId` column).

### 6. API Response Changes

All API responses now return `publicId` instead of `id`:

```json
// Before
{ "id": 42, "name": "My Org", "slug": "my-org" }

// After
{ "publicId": "org_abc123xyz789", "name": "My Org", "slug": "my-org" }
```

Internal `id` is never exposed to the frontend.

## Database Migration

### Running the Migration

Apply the migration to add public_id columns:

```bash
# Using psql directly
psql $DATABASE_URL -f migrations/0001_add_public_ids.sql
psql $DATABASE_URL -f migrations/0002_add_release_and_role_public_ids.sql

# Or using drizzle-kit
npx drizzle-kit push
```

### Migration Details

The first migration (`migrations/0001_add_public_ids.sql`):

1. Adds `public_id` columns to organizations, users, prds, and github_repos tables
2. Generates public IDs for existing records using UUID-based values
3. Adds NOT NULL constraints
4. Creates unique indexes

The second migration (`migrations/0002_add_release_and_role_public_ids.sql`):

1. Renames `release_id` to `public_id` in releases table, adds `rel_` prefix to existing values
2. Changes releases primary key from `release_id` to `id` (serial)
3. Renames `id` to `public_id` in roles table, adds `role_` prefix to existing values
4. Adds serial `id` column to roles table as new primary key
5. Renames `release_id` and `role_id` to `release_public_id` and `role_public_id` in role_docs table
6. Updates role_docs foreign key references
7. Creates indexes for new public_id columns

## Error Responses

| Status | Meaning |
|--------|---------|
| 400 | Invalid publicId format (e.g., missing prefix, wrong format) |
| 401 | User not authenticated |
| 403 | User lacks required permission level |
| 404 | Resource not found OR user doesn't have access (intentionally ambiguous) |

Example 400 error:
```json
{
  "error": "Invalid PRD ID format. Expected format: prd_xxxxxxxxxxxx"
}
```

## Security Best Practices

### For New Features

1. **Always use authorization middleware**:
   ```typescript
   app.get(
     "/api/organization/:org_public_id/resource",
     ...requireOrgMember("org_public_id"),
     authorizedHandler<AuthorizedOrgRequest>(async (req, res) => {
       // req.organization, req.currentUser, req.userRole available
     })
   )
   ```

2. **Validate publicId format**:
   ```typescript
   import { hasValidPrefix } from "../public-ids"
   
   if (!hasValidPrefix(prd_id, "prd")) {
     res.status(400).json({ error: "Invalid PRD ID format" })
     return
   }
   ```

3. **Verify resource ownership**:
   ```typescript
   const resource = await storage.getResource(id)
   if (!verifyResourceOwnership(resource, req, res, "Resource")) {
     return
   }
   ```

4. **Return publicId in responses**, never internal id:
   ```typescript
   res.json({
     publicId: entity.publicId,
     name: entity.name,
     // ... other fields, but NOT id
   })
   ```

5. **Use appropriate role requirements**:
   - Read operations: `requireOrgMember`
   - Create operations: `requireOrgMember`
   - Update operations: `requireOrgAdmin`
   - Delete operations: `requireOrgAdmin` or `requireOrgOwner`

### Error Response Guidelines

- Return `404 Not Found` for resources that don't exist OR don't belong to the user's org
- Never reveal whether a resource exists if the user doesn't have access
- Log security violations server-side but return generic errors to clients

## Testing

### Authorization Tests

Test that:
1. Unauthenticated requests return 401
2. Non-member requests return 403
3. Insufficient role requests return 403
4. Cross-organization access returns 404 (not 403)
5. Invalid publicId format returns 400

### Public ID Tests

Test that:
1. API responses contain `publicId`, not `id`
2. Invalid publicId format returns 400 with helpful message
3. Routes reject numeric IDs (no backward compatibility)
4. Public IDs cannot be enumerated (no sequential patterns)

## Files Changed

| File | Change |
|------|--------|
| `src/lib/public-ids.ts` | Created - ID utilities |
| `src/lib/routes/authorization.ts` | Created - Auth middleware |
| `src/shared/schema.ts` | Added publicId columns to orgs, users, prds, repos |
| `src/storage.ts` | Added publicId methods for all entities |
| `src/lib/routes/organizations.ts` | Updated routes to use publicId |
| `src/lib/routes/prd.ts` | Updated routes to use publicId |
| `src/lib/routes/releases.ts` | Updated routes to use release_public_id param, request body uses repoPublicId |
| `src/lib/routes/documents.ts` | Updated routes to use publicId |
| `src/lib/routes/code.ts` | Updated routes to use repo_public_id |
| `src/lib/routes/roles.ts` | Updated to use role.publicId for storage operations |
| `src/lib/routes/auth.ts` | Updated to return publicId |
| `src/lib/routes/github.ts` | Updated routes to use repo_public_id |
| `src/lib/routes/middleware.ts` | Updated withRepo to use publicId, type updates |
| `migrations/0001_add_public_ids.sql` | Database migration for orgs, users, prds, repos |
| `migrations/0002_add_release_and_role_public_ids.sql` | Database migration for releases, roles, role_docs |

## Future Improvements

1. **Rate limiting**: Add rate limiting to prevent brute-force attacks on public IDs
2. **Audit logging**: Log all authorization failures for security monitoring
3. **RBAC expansion**: Consider more granular permissions beyond owner/admin/member
4. **API versioning**: Consider versioning the API for future breaking changes
# Frontend Migration Prompt: Security Updates

Use this prompt with your AI assistant to migrate your frontend code to work with the new security improvements on the backend.

---

## Prompt

I need to migrate my frontend application to work with backend security changes. The backend has been updated to use public IDs exclusively instead of numeric IDs. There is NO backward compatibility - all routes now require public IDs.

### 1. Public IDs Instead of Numeric IDs

The API now returns `publicId` instead of internal numeric `id` for these entities:
- **Organizations**: `org_xxxxxxxxxxxx`
- **Users**: `usr_xxxxxxxxxxxx`  
- **PRDs**: `prd_xxxxxxxxxxxx`
- **Repositories**: `repo_xxxxxxxxxxxx`

API responses have changed:

**Before:**
```json
{
  "id": 42,
  "name": "John Doe",
  "email": "john@example.com"
}
```

**After:**
```json
{
  "publicId": "usr_abc123xyz789",
  "name": "John Doe", 
  "email": "john@example.com"
}
```

**Repository example - Before:**
```json
{
  "id": 5,
  "name": "my-repo",
  "fullName": "owner/my-repo",
  "repoId": "12345678"
}
```

**Repository example - After:**
```json
{
  "publicId": "repo_abc123xyz789",
  "name": "my-repo",
  "fullName": "owner/my-repo"
}
```

Note: The GitHub `repoId` (external GitHub ID) is no longer exposed in responses. Use `publicId` for all API calls.

### 2. ALL Route URL Changes

Every route that previously used numeric IDs now uses `publicId`. Here are the complete route changes:

#### Organization Routes
| Before | After |
|--------|-------|
| `GET /api/organization/:id` | `GET /api/organization/:org_public_id` |
| `PUT /api/organization/:org_id` | `PUT /api/organization/:org_public_id` |
| `DELETE /api/organization/:id` | `DELETE /api/organization/:org_public_id` |
| `GET /api/organization/:id/users` | `GET /api/organization/:org_public_id/users` |
| `POST /api/organization/:id/users` | `POST /api/organization/:org_public_id/users` |
| `DELETE /api/organization/:id/users/:userId` | `DELETE /api/organization/:org_public_id/users/:user_public_id` |
| `PATCH /api/organization/:id/users/:userId` | `PATCH /api/organization/:org_public_id/users/:user_public_id` |
| `POST /api/organization/:id/invite` | `POST /api/organization/:org_public_id/invite` |

#### PRD Routes
| Before | After |
|--------|-------|
| `GET /api/organization/:org_id/prds` | `GET /api/organization/:org_public_id/prds` |
| `GET /api/organization/:org_id/prds/search` | `GET /api/organization/:org_public_id/prds/search` |
| `GET /api/organization/:org_id/prds/:prd_id` | `GET /api/organization/:org_public_id/prds/:prd_id` (prd_id must be publicId like `prd_xxx`) |
| `POST /api/organization/:org_id/prds` | `POST /api/organization/:org_public_id/prds` |
| `PATCH /api/organization/:org_id/prds/:prd_id` | `PATCH /api/organization/:org_public_id/prds/:prd_id` |
| `DELETE /api/organization/:org_id/prds/:prd_id` | `DELETE /api/organization/:org_public_id/prds/:prd_id` |

#### Release Routes
| Before | After |
|--------|-------|
| `POST /api/organization/:org_id/releases` | `POST /api/organization/:org_public_id/releases` |
| `GET /api/organization/:org_id/releases` | `GET /api/organization/:org_public_id/releases` |
| `GET /api/organization/:org_id/releases/:id` | `GET /api/organization/:org_public_id/releases/:id` |
| `DELETE /api/organization/:org_id/releases/:id` | `DELETE /api/organization/:org_public_id/releases/:id` |
| `GET /api/organization/:org_id/recent-releases` | `GET /api/organization/:org_public_id/recent-releases` |
| `GET /api/organization/:org_id/pending-releases` | `GET /api/organization/:org_public_id/pending-releases` |
| `POST /api/organization/:org_id/releases/:release_id/role-docs` | `POST /api/organization/:org_public_id/releases/:release_id/role-docs` |
| `GET /api/organization/:org_id/releases/:id/role-docs` | `GET /api/organization/:org_public_id/releases/:id/role-docs` |

#### Repository/Code Routes
| Before | After |
|--------|-------|
| `GET /api/organization/:org_id/repos` | `GET /api/organization/:org_public_id/repos` |
| `GET /api/organization/:org_id/repos/:repo_id` | `GET /api/organization/:org_public_id/repos/:repo_public_id` |
| `DELETE /api/organization/:org_id/repos/:repo_id` | `DELETE /api/organization/:org_public_id/repos/:repo_public_id` |
| `PATCH /api/organization/:org_id/repos/:repo_id` | `PATCH /api/organization/:org_public_id/repos/:repo_public_id` |
| `GET /api/organization/:org_id/repos/:repo_id/embeddings` | `GET /api/organization/:org_public_id/repos/:repo_public_id/embeddings` |
| `POST /api/organization/:org_id/repos/:repo_id/analyze` | `POST /api/organization/:org_public_id/repos/:repo_public_id/analyze` |
| `POST /api/organization/:org_id/repos/:repo_id/generate-cfg` | `POST /api/organization/:org_public_id/repos/:repo_public_id/generate-cfg` |
| `GET /api/organization/:org_id/repos/:repo_id/cfg` | `GET /api/organization/:org_public_id/repos/:repo_public_id/cfg` |
| `GET /api/organization/:org_id/repos/:repo_id/releases/check` | `GET /api/organization/:org_public_id/repos/:repo_public_id/releases/check` |

Note: `repo_public_id` must be in format `repo_xxxxxxxxxxxx`. The old GitHub `repoId` is no longer accepted.

#### Document Routes
| Before | After |
|--------|-------|
| `POST /api/organization/:org_id/repos/:repo_id/generate` | `POST /api/organization/:org_public_id/repos/:repo_public_id/generate` |
| `POST /api/organization/:org_id/repos/:repo_id/compare` | `POST /api/organization/:org_public_id/repos/:repo_public_id/compare` |
| `GET /api/organization/:org_id/repos/:repo_id/docs` | `GET /api/organization/:org_public_id/repos/:repo_public_id/docs` |
| `GET /api/organization/:org_id/repos/:repo_id/docs_status` | `GET /api/organization/:org_public_id/repos/:repo_public_id/docs_status` |
| `GET /api/organization/:org_id/repos/:repo_id/docs_status/:job_id` | `GET /api/organization/:org_public_id/repos/:repo_public_id/docs_status/:job_id` |
| `GET /api/organization/:org_id/recent-documents` | `GET /api/organization/:org_public_id/recent-documents` |

#### GitHub Routes
| Before | After |
|--------|-------|
| `GET /api/github/repos/:repo_id/files` | `GET /api/github/repos/:repo_public_id/files` |
| `GET /api/github/repos/:repo_id/branches` | `GET /api/github/repos/:repo_public_id/branches` |

#### Role Routes
| Before | After |
|--------|-------|
| `GET /api/organization/:org_id/roles` | `GET /api/organization/:org_public_id/roles` |
| `GET /api/organization/:org_id/roles/:role_type` | `GET /api/organization/:org_public_id/roles/:role_type` |
| `PUT /api/organization/:org_id/roles/:role_type` | `PUT /api/organization/:org_public_id/roles/:role_type` |

### 3. Authorization Changes

- All organization routes now require the user to be a member of that organization
- Some routes require elevated permissions (admin/owner)
- Cross-organization access now returns 404 (not 403) to prevent enumeration
- Invalid publicId format returns 400 with error message

### Migration Tasks

Please help me update my frontend code to:

1. **Update TypeScript/JavaScript types/interfaces:**
   - Replace `id: number` with `publicId: string` for User, Organization, and PRD types
   - Remove `id` field entirely - it is no longer returned by the API

2. **Update ALL API URL construction:**
   - Replace ALL occurrences of numeric organization IDs with `organization.publicId`
   - Replace ALL occurrences of numeric user IDs with `user.publicId`
   - Replace ALL occurrences of numeric PRD IDs with `prd.publicId`
   - Replace ALL occurrences of GitHub `repoId` with `repo.publicId`
   
   Example:
   ```typescript
   // Before
   `/api/organization/${org.id}/users/${user.id}`
   `/api/organization/${org.id}/repos/${repo.repoId}`
   
   // After
   `/api/organization/${org.publicId}/users/${user.publicId}`
   `/api/organization/${org.publicId}/repos/${repo.publicId}`
   ```

3. **Update state management:**
   - Update any Redux/Zustand/Pinia stores that store entities by ID
   - Change map keys from numeric IDs to publicIds
   - Update selectors that look up by ID

4. **Update localStorage/sessionStorage:**
   - If you store current organization ID, update to store publicId
   - Clear/migrate any cached data that uses old ID format

5. **Update URL routing (if applicable):**
   - If your frontend routes include organization/user IDs, update to use publicId
   - Example: `/dashboard/:orgId` → `/dashboard/:orgPublicId`

6. **Handle authorization errors:**
   - 400: Invalid publicId format → show validation error
   - 401: User not authenticated → redirect to login
   - 403: User lacks permission → show "Access Denied" message
   - 404: Resource not found OR user doesn't have access → show "Not Found" message

### Updated Type Definitions

```typescript
// User type
interface User {
  publicId: string;        // e.g., "usr_abc123xyz789"
  name: string;
  email: string | null;
  themePreferences?: ThemePreferences;
}

// Organization type
interface Organization {
  publicId: string;        // e.g., "org_abc123xyz789"
  name: string;
  slug: string;
  description: string | null;
  isPersonal: boolean;
  profileImageUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

// PRD type
interface PRD {
  publicId: string;        // e.g., "prd_abc123xyz789"
  title: string;
  content: string;
  businessContext: string;
  repoId: string;          // Note: This is still the GitHub repo ID for internal reference
  branch: string | null;
}

// Repository type
interface Repository {
  publicId: string;        // e.g., "repo_abc123xyz789"
  name: string;
  fullName: string;
  owner: string;
  fileFilterRegex: string | null;
  createdAt: string;
}

// Organization member (from /api/organization/:org_public_id/users)
interface OrganizationMember {
  publicId: string;        // User's publicId
  email: string | null;
  name: string;
  role: "owner" | "admin" | "member";
}
```

### Example API Call Changes

```typescript
// Before: Get organization
const org = await fetch(`/api/organization/${orgId}`);

// After: Use publicId
const org = await fetch(`/api/organization/${orgPublicId}`);

// Before: Remove user from organization
await fetch(`/api/organization/${orgId}/users/${userId}`, {
  method: 'DELETE',
});

// After: Use publicIds for both
await fetch(`/api/organization/${org.publicId}/users/${user.publicId}`, {
  method: 'DELETE',
});

// Before: Get PRD
const prd = await fetch(`/api/organization/${orgId}/prds/${prdId}`);

// After: Use publicIds
const prd = await fetch(`/api/organization/${org.publicId}/prds/${prd.publicId}`);

// Before: Add user to organization (request body)
await fetch(`/api/organization/${orgId}/users`, {
  method: 'POST',
  body: JSON.stringify({ userId: 42, role: 'member' }),
});

// After: Use publicId in body
await fetch(`/api/organization/${org.publicId}/users`, {
  method: 'POST',
  body: JSON.stringify({ userPublicId: 'usr_abc123xyz789', role: 'member' }),
});

// Before: Get repo details
const repo = await fetch(`/api/organization/${orgId}/repos/${repo.repoId}`);

// After: Use publicIds
const repo = await fetch(`/api/organization/${org.publicId}/repos/${repo.publicId}`);

// Before: Create release (request body)
await fetch(`/api/organization/${orgId}/releases`, {
  method: 'POST',
  body: JSON.stringify({ title: 'v1.0', repoId: '12345678', branch: 'main', roles: [] }),
});

// After: Use repo publicId in body
await fetch(`/api/organization/${org.publicId}/releases`, {
  method: 'POST',
  body: JSON.stringify({ title: 'v1.0', repoPublicId: 'repo_abc123xyz789', branch: 'main', roles: [] }),
});
```

### PublicId Format Reference

| Entity | Format | Example |
|--------|--------|---------|
| Organization | `org_` + 12 chars | `org_a1b2c3d4e5f6` |
| User | `usr_` + 12 chars | `usr_x9y8z7w6v5u4` |
| PRD | `prd_` + 12 chars | `prd_m1n2o3p4q5r6` |
| Repository | `repo_` + 12 chars | `repo_j7k8l9m0n1o2` |

### Files to Search and Update

Please search my codebase for:
1. Type definitions containing `id: number` for User, Organization, PRD, or Repository
2. ALL API calls containing `/api/organization/` or `/api/github/repos/`
3. ANY URL construction using `.id`, `['id']`, or `.repoId` for these entities
4. State management code that indexes by numeric ID or repoId
5. localStorage/sessionStorage operations involving entity IDs
6. Router configurations with numeric ID parameters
7. Any hardcoded numeric IDs or repoIds in tests or mock data
8. References to `repo.repoId` that should now be `repo.publicId`

### Regex Patterns to Search

```
# Find API calls with organization routes
/api/organization/\$\{[^}]+\.id\}
/api/organization/\$\{[^}]+\[['"]id['"]\]\}

# Find type definitions
id:\s*(number|Number)

# Find ID property access
\.(id)\b
\['id'\]
\["id"\]

# Find repoId property access (should now use publicId)
\.repoId\b
\['repoId'\]
\["repoId"\]
```

---

## Additional Context to Provide

When using this prompt, also share:

1. Your frontend framework (React, Vue, Angular, etc.)
2. Your state management solution (Redux, Zustand, Pinia, etc.)
3. Your API client setup (fetch, axios, react-query, etc.)
4. Any relevant type definition files
5. Components that handle organization/user management
6. Your routing configuration
7. Any caching or persistence layers

---

## Verification Checklist

After migration, verify:

- [ ] All type definitions use `publicId: string` instead of `id: number` or `repoId: string`
- [ ] All API URLs use `publicId` in path parameters
- [ ] Organization list loads correctly (returns publicId)
- [ ] Single organization view loads correctly
- [ ] Users can view organization members (returns publicId)
- [ ] Users can be added to organizations (request body uses userPublicId)
- [ ] Users can be removed from organizations (URL uses user_public_id)
- [ ] User roles can be updated (URL uses user_public_id)
- [ ] PRDs can be created (response contains publicId)
- [ ] PRDs can be viewed, updated, and deleted (URL uses prd publicId)
- [ ] Repository list loads correctly (returns publicId, not repoId)
- [ ] Single repository view loads correctly (URL uses repo_public_id)
- [ ] Repository analyze/generate operations work correctly
- [ ] Releases can be created (request body uses repoPublicId, not repoId)
- [ ] Releases work correctly
- [ ] GitHub file browser works (uses repo_public_id)
- [ ] GitHub branch listing works (uses repo_public_id)
- [ ] No console errors related to missing `id` or `repoId` properties
- [ ] No 400 errors about invalid ID format
- [ ] State management correctly indexes by publicId
- [ ] localStorage/sessionStorage uses publicId
- [ ] Frontend routes use publicId (if applicable)
- [ ] Tests updated to use publicId format
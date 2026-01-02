import type { Request, Response, NextFunction, RequestHandler } from "express"
import { storage } from "../../storage"
import { getUserSub } from "../helpers"
import type { Organization, GithubRepo } from "../../shared/schema"
import type { AuthorizedOrgRequest } from "./authorization"
import { hasValidPrefix } from "../public-ids"

// Extended request types with validated resources
export interface OrganizationRequest extends Request {
  organization: Organization
  orgId: number
}

// RepoRequest extends AuthorizedOrgRequest to include repo-specific fields
export interface RepoRequest extends AuthorizedOrgRequest {
  repo: GithubRepo
  repoPublicId: string // Internal repo public ID (repo_xxxxxxxxxxxx) - use for all DB operations
  repoId: string // GitHub's external repo ID (for GitHub API calls ONLY)
  branch: string
}

export interface UserRequest extends Request {
  userSub: string
}

export interface OrgSlugRequest extends Request {
  organization: Organization
  orgSlug: string
}

// Error message helper
export function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

// Async route handler wrapper that catches errors
export function asyncHandler<T extends Request = Request>(
  fn: (req: T, res: Response, next: NextFunction) => Promise<void>,
  errorMessage = "An error occurred"
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req as T, res, next)).catch((error: unknown) => {
      console.error(errorMessage, error)
      const message = getErrorMessage(error, errorMessage)
      res.status(500).json({ error: message })
    })
  }
}

// Middleware to validate organization by ID and attach to request
// Legacy middleware - prefer using authorization.ts middleware
export function withOrganization(): RequestHandler {
  return async (req, res, next) => {
    try {
      const { org_id } = req.params
      if (!org_id) {
        res.status(400).json({ error: "Organization ID is required" })
        return
      }

      const organization = await storage.getOrganization(parseInt(org_id, 10))
      if (!organization) {
        res.status(404).json({ error: "Organization not found" })
        return
      }

      ;(req as OrganizationRequest).organization = organization
      ;(req as OrganizationRequest).orgId = parseInt(org_id)
      next()
    } catch (error) {
      const message = getErrorMessage(error, "Failed to validate organization")
      res.status(500).json({ error: message })
    }
  }
}

// Middleware to validate repo belongs to organization and attach to request
// Uses repo publicId (repo_xxxxxxxxxxxx) instead of GitHub's repoId
export function withRepo(): RequestHandler {
  return async (req, res, next) => {
    try {
      const { repo_public_id } = req.params
      const branch = (req.query.branch as string) || "main"

      if (!repo_public_id) {
        res.status(400).json({ error: "Repository ID is required" })
        return
      }

      // Validate publicId format
      if (!hasValidPrefix(repo_public_id, "repo")) {
        res.status(400).json({
          error:
            "Invalid repository ID format. Expected format: repo_xxxxxxxxxxxx",
        })
        return
      }

      // Support both legacy OrganizationRequest and new AuthorizedOrgRequest
      const organization =
        (req as OrganizationRequest).organization ||
        (req as AuthorizedOrgRequest).organization
      if (!organization) {
        res
          .status(500)
          .json({ error: "Organization middleware must be applied first" })
        return
      }

      const repo = await storage.getRepoByPublicId(repo_public_id)
      if (!repo) {
        res.status(404).json({ error: "Repository not found" })
        return
      }

      if (repo.organizationId !== organization.id) {
        // Return 404 instead of 403 to prevent enumeration
        res.status(404).json({ error: "Repository not found" })
        return
      }

      ;(req as RepoRequest).repo = repo
      ;(req as RepoRequest).repoPublicId = repo.publicId // Internal public ID for DB operations
      ;(req as RepoRequest).repoId = repo.repoId // GitHub's external ID for API calls
      ;(req as RepoRequest).branch = branch
      next()
    } catch (error) {
      const message = getErrorMessage(error, "Failed to validate repository")
      res.status(500).json({ error: message })
    }
  }
}

// Middleware to validate user sub from JWT
export function withUserSub(): RequestHandler {
  return (req, res, next) => {
    const userSub = getUserSub(req, res)
    if (!userSub) return
    ;(req as UserRequest).userSub = userSub
    next()
  }
}

// Middleware to validate organization by slug (from query params)
export function withOrganizationBySlug(): RequestHandler {
  return async (req, res, next) => {
    try {
      const { orgSlug } = req.query
      if (!orgSlug || typeof orgSlug !== "string") {
        res.status(401).json({ error: "Organization not provided" })
        return
      }

      const organization = await storage.getOrganizationBySlug(orgSlug)
      if (!organization) {
        res.status(404).json({ error: "Organization not found" })
        return
      }

      ;(req as OrgSlugRequest).organization = organization
      ;(req as OrgSlugRequest).orgSlug = orgSlug
      next()
    } catch (error) {
      const message = getErrorMessage(error, "Failed to validate organization")
      res.status(500).json({ error: message })
    }
  }
}

// Middleware to require GitHub authentication for organization
export function requireGitHubAuth(): RequestHandler {
  return (req, res, next) => {
    const organization = (req as OrgSlugRequest).organization
    if (!organization) {
      res
        .status(500)
        .json({ error: "Organization middleware must be applied first" })
      return
    }

    if (!organization.accessToken && !organization.installationId) {
      res
        .status(401)
        .json({ error: "Organization not authenticated with GitHub" })
      return
    }

    next()
  }
}

// Helper to get repo by publicId (for cases where middleware isn't applicable)
export async function getRepoByPublicId(
  publicId: string,
  res: Response
): Promise<GithubRepo | undefined> {
  if (!hasValidPrefix(publicId, "repo")) {
    res.status(400).json({
      error: "Invalid repository ID format. Expected format: repo_xxxxxxxxxxxx",
    })
    return undefined
  }

  const data = await storage.getRepoByPublicId(publicId)
  if (!data) {
    res.status(404).json({ error: "Repository not found" })
    return undefined
  }
  return data
}

// Helper to validate repo belongs to organization
export function validateRepoOrganization(
  repo: GithubRepo,
  organization: Organization,
  res: Response
): boolean {
  if (repo.organizationId !== organization.id) {
    // Return 404 instead of 403 to prevent enumeration
    res.status(404).json({ error: "Repository not found" })
    return false
  }
  return true
}

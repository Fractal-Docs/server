import type { Request, Response, NextFunction, RequestHandler } from "express"
import { storage } from "../../storage"
import { getParams, getUserSub } from "../helpers"
import type { Organization, GithubRepo } from "../../shared/schema"

// Extended request types with validated resources
export interface OrganizationRequest extends Request {
  organization: Organization
  orgId: number
}

export interface RepoRequest extends OrganizationRequest {
  repo: GithubRepo
  repoId: string
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
export function withOrganization(): RequestHandler {
  return async (req, res, next) => {
    try {
      const { org_id } = getParams(req, res, ["org_id"])
      if (!org_id) return

      const organization = await storage.getOrganization(org_id)
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
export function withRepo(): RequestHandler {
  return async (req, res, next) => {
    try {
      const { repo_id, branch } = getParams(req, res, ["repo_id", "branch"])
      if (!repo_id) return

      const organization = (req as OrganizationRequest).organization
      if (!organization) {
        res
          .status(500)
          .json({ error: "Organization middleware must be applied first" })
        return
      }

      const repo = await storage.getRepo(repo_id)
      if (!repo) {
        res.status(404).json({ error: "Repository not found" })
        return
      }

      if (repo.organizationId !== organization.id) {
        res.status(403).json({ error: "Repository not part of organization" })
        return
      }

      ;(req as RepoRequest).repo = repo
      ;(req as RepoRequest).repoId = repo_id
      ;(req as RepoRequest).branch = branch || "main"
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

// Helper to get repo by ID (for cases where middleware isn't applicable)
export async function getRepoById(
  id: string,
  res: Response
): Promise<GithubRepo | undefined> {
  const data = await storage.getRepo(id)
  if (!data) {
    res.status(404).json({ error: "No repository found" })
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
    res.status(403).json({ error: "Repository not part of organization" })
    return false
  }
  return true
}

import type { Request, Response, NextFunction, RequestHandler } from "express"
import { storage } from "../../storage"
import { getUserSub } from "../helpers"
import type { Organization, User } from "../../shared/schema"
import { hasValidPrefix } from "../public-ids"
import { asyncHandler } from "./middleware"

/**
 * Authorization middleware module
 *
 * This module provides middleware for checking user permissions on resources,
 * preventing unauthorized access even if someone guesses or enumerates IDs.
 *
 * All organization lookups use publicId exclusively - no numeric IDs supported.
 */

// Extended request type with authorization context
export interface AuthorizedRequest extends Request {
  currentUser: User
  userSub: string
}

export interface AuthorizedOrgRequest extends AuthorizedRequest {
  organization: Organization
  orgId: string
  orgPublicId: string
  userRole: "owner" | "admin" | "member"
}

// Role hierarchy for permission checks
const ROLE_HIERARCHY: Record<string, number> = {
  owner: 3,
  admin: 2,
  member: 1,
}

/**
 * Checks if a role has at least the minimum required permission level
 */
function hasMinimumRole(
  userRole: string,
  minimumRole: "owner" | "admin" | "member"
): boolean {
  const userLevel = ROLE_HIERARCHY[userRole] || 0
  const requiredLevel = ROLE_HIERARCHY[minimumRole] || 0
  return userLevel >= requiredLevel
}

/**
 * Middleware to require an authenticated user and attach user to request
 * This should be used as a base for all protected routes
 */
export function requireAuth(): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userSub = getUserSub(req, res)
      if (!userSub) {
        // getUserSub already sent the 401 response
        return
      }

      const user = await storage.getUser(userSub)
      if (!user) {
        res
          .status(401)
          .json({ error: "User not found. Please complete registration." })
        return
      }

      ;(req as AuthorizedRequest).currentUser = user
      ;(req as AuthorizedRequest).userSub = userSub
      next()
    } catch (error) {
      console.error("Authorization error:", error)
      res.status(500).json({ error: "Authorization failed" })
    }
  }
}

/**
 * Middleware to require organization membership
 * Must be used after requireAuth()
 *
 * Supports organization lookup by:
 * - publicId (org_xxxxxxxxxxxx)
 * - slug (for backward compatibility with some routes)
 *
 * @param options.paramName - The route parameter name for org ID (default: "org_id" or "id")
 * @param options.minimumRole - Minimum role required (default: "member")
 */
export function requireOrgMembership(options?: {
  paramName?: string
  minimumRole?: "owner" | "admin" | "member"
}): RequestHandler {
  const paramName = options?.paramName
  const minimumRole = options?.minimumRole || "member"

  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const authReq = req as AuthorizedRequest

      if (!authReq.currentUser) {
        res
          .status(500)
          .json({ error: "requireAuth middleware must be applied first" })
        return
      }

      // Try multiple param names for flexibility
      const orgIdParam =
        req.params[paramName || "org_id"] ||
        req.params.id ||
        req.params.organizationId ||
        req.params.org_public_id

      if (!orgIdParam) {
        res.status(400).json({ error: "Organization ID is required" })
        return
      }

      let organization: Organization | undefined

      if (hasValidPrefix(orgIdParam, "org")) {
        // Public ID lookup
        organization = await storage.getOrganizationByPublicId(orgIdParam)
      } else if (/^[a-z0-9-]+$/.test(orgIdParam) && !orgIdParam.includes("_")) {
        // Looks like a slug (lowercase alphanumeric with hyphens, no underscores)
        organization = await storage.getOrganizationBySlug(orgIdParam)
      } else {
        // Invalid format
        res.status(400).json({
          error:
            "Invalid organization identifier. Use publicId (org_xxx) or slug.",
        })
        return
      }

      if (!organization) {
        res.status(404).json({ error: "Organization not found" })
        return
      }

      // Check user's membership and role in this organization
      const userOrgRole = await storage.getUserOrganizationRole(
        authReq.currentUser.publicId,
        organization.publicId
      )

      if (!userOrgRole) {
        res
          .status(403)
          .json({ error: "You are not a member of this organization" })
        return
      }

      // Check minimum role requirement
      if (!hasMinimumRole(userOrgRole.role, minimumRole)) {
        res.status(403).json({
          error: `This action requires ${minimumRole} permissions or higher`,
        })
        return
      }

      ;(req as AuthorizedOrgRequest).organization = organization
      ;(req as AuthorizedOrgRequest).orgId = organization.publicId
      ;(req as AuthorizedOrgRequest).orgPublicId = organization.publicId
      ;(req as AuthorizedOrgRequest).userRole = userOrgRole.role as
        | "owner"
        | "admin"
        | "member"
      next()
    } catch (error) {
      console.error("Organization authorization error:", error)
      res.status(500).json({ error: "Authorization failed" })
    }
  }
}

/**
 * Middleware to require owner role for an organization
 * Convenience wrapper around requireOrgMembership
 */
export function requireOrgOwner(paramName?: string): RequestHandler[] {
  return [
    requireAuth(),
    requireOrgMembership({ paramName, minimumRole: "owner" }),
  ]
}

/**
 * Middleware to require admin role (or higher) for an organization
 * Convenience wrapper around requireOrgMembership
 */
export function requireOrgAdmin(paramName?: string): RequestHandler[] {
  return [
    requireAuth(),
    requireOrgMembership({ paramName, minimumRole: "admin" }),
  ]
}

/**
 * Middleware to require member role (or higher) for an organization
 * Convenience wrapper around requireOrgMembership
 */
export function requireOrgMember(paramName?: string): RequestHandler[] {
  return [
    requireAuth(),
    requireOrgMembership({ paramName, minimumRole: "member" }),
  ]
}

/**
 * Helper to verify a resource belongs to the organization in the request
 * Use this in route handlers after applying org membership middleware
 */
export function verifyResourceOwnership<T extends { organizationId: string }>(
  resource: T | undefined | null,
  req: AuthorizedOrgRequest,
  res: Response,
  resourceName: string = "Resource"
): resource is T {
  if (!resource) {
    res.status(404).json({ error: `${resourceName} not found` })
    return false
  }

  if (resource.organizationId !== req.orgId) {
    // Log potential security issue but return generic 404 to prevent enumeration
    console.warn(
      `Authorization violation: User ${req.currentUser.publicId} attempted to access ${resourceName} belonging to org ${resource.organizationId} via org ${req.orgId}`
    )
    res.status(404).json({ error: `${resourceName} not found` })
    return false
  }

  return true
}

/**
 * Helper to check if the current user can modify another user in the org
 * Owners can modify anyone, admins can modify members, members can only modify themselves
 */
export function canModifyUser(
  req: AuthorizedOrgRequest,
  targetUserId: string
): boolean {
  // Users can always modify themselves
  if (req.currentUser.publicId === targetUserId) {
    return true
  }

  // Only owners and admins can modify others
  return hasMinimumRole(req.userRole, "admin")
}

/**
 * Async handler wrapper with authorization context
 * Similar to asyncHandler but with proper typing for authorized requests
 */
export function authorizedHandler<
  T extends AuthorizedRequest = AuthorizedRequest,
>(
  fn: (req: T, res: Response, next: NextFunction) => Promise<void>,
  errorMessage = "An error occurred"
): RequestHandler {
  return asyncHandler<T>(fn, errorMessage)
}

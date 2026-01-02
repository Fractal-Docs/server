import type { Express } from "express"
import { storage } from "../../storage"
import {
  insertOrganizationSchema,
  insertUserOrganizationSchema,
} from "../../shared/schema"
import { fromZodError } from "zod-validation-error"
import { sendInviteEmail } from "../email"
import {
  requireAuth,
  requireOrgMember,
  requireOrgAdmin,
  requireOrgOwner,
  authorizedHandler,
  canModifyUser,
  AuthorizedRequest,
  AuthorizedOrgRequest,
} from "./authorization"
import { hasValidPrefix } from "../public-ids"

export function organizationRoutes(app: Express) {
  // Get user's organizations - requires authenticated user
  app.get(
    "/api/organizations",
    requireAuth(),
    authorizedHandler<AuthorizedRequest>(async (req, res) => {
      const userOrganizations = await storage.getOrganizationsByUserId(
        req.currentUser.publicId
      )
      // Return organizations with publicId
      const sanitizedOrgs = userOrganizations.map((org) => ({
        publicId: org.publicId,
        name: org.name,
        slug: org.slug,
        description: org.description,
        isPersonal: org.isPersonal,
        profileImageUrl: org.profileImageUrl,
        createdAt: org.createdAt,
        updatedAt: org.updatedAt,
      }))
      res.json(sanitizedOrgs)
    }, "Failed to fetch organizations")
  )

  // Get specific organization - requires membership
  // Uses publicId: /api/organization/org_xxxxxxxxxxxx
  app.get(
    "/api/organization/:org_public_id",
    ...requireOrgMember("org_public_id"),
    authorizedHandler<AuthorizedOrgRequest>(async (req, res) => {
      // Return organization with publicId, not internal id
      res.json({
        publicId: req.organization.publicId,
        name: req.organization.name,
        slug: req.organization.slug,
        description: req.organization.description,
        isPersonal: req.organization.isPersonal,
        profileImageUrl: req.organization.profileImageUrl,
        installationId: req.organization.installationId,
        accessToken: req.organization.accessToken ? "[REDACTED]" : null,
        createdAt: req.organization.createdAt,
        updatedAt: req.organization.updatedAt,
      })
    }, "Failed to fetch organization")
  )

  // Create new organization - requires authenticated user
  app.post(
    "/api/organizations",
    requireAuth(),
    authorizedHandler<AuthorizedRequest>(async (req, res) => {
      const result = insertOrganizationSchema.safeParse(req.body)
      if (!result.success) {
        res.status(400).json({ error: fromZodError(result.error).toString() })
        return
      }

      const organization = await storage.createOrganization(result.data)

      // Add the creator as owner of the organization
      await storage.addUserToOrganization({
        userId: req.currentUser.publicId,
        organizationId: organization.publicId,
        role: "owner",
      })

      // Return organization with publicId
      res.json({
        publicId: organization.publicId,
        name: organization.name,
        slug: organization.slug,
        description: organization.description,
        isPersonal: organization.isPersonal,
        profileImageUrl: organization.profileImageUrl,
        createdAt: organization.createdAt,
        updatedAt: organization.updatedAt,
      })
    }, "Failed to create organization")
  )

  // Update organization - requires admin role
  app.put(
    "/api/organization/:org_public_id",
    ...requireOrgAdmin("org_public_id"),
    authorizedHandler<AuthorizedOrgRequest>(async (req, res) => {
      const result = insertOrganizationSchema.partial().safeParse(req.body)
      if (!result.success) {
        res.status(400).json({ error: fromZodError(result.error).toString() })
        return
      }

      const organization = await storage.updateOrganization(
        req.organization.slug,
        result.data
      )

      // Return organization with publicId
      res.json({
        publicId: organization.publicId,
        name: organization.name,
        slug: organization.slug,
        description: organization.description,
        isPersonal: organization.isPersonal,
        profileImageUrl: organization.profileImageUrl,
        createdAt: organization.createdAt,
        updatedAt: organization.updatedAt,
      })
    }, "Failed to update organization")
  )

  // Delete organization - requires owner role
  app.delete(
    "/api/organization/:org_public_id",
    ...requireOrgOwner("org_public_id"),
    authorizedHandler<AuthorizedOrgRequest>(async (req, res) => {
      await storage.removeAllUsersFromOrganization(req.orgId)
      await storage.deleteOrganization(req.orgId)
      res.json({ success: true })
    }, "Failed to delete organization")
  )

  // Get all users in organization - requires membership
  app.get(
    "/api/organization/:org_public_id/users",
    ...requireOrgMember("org_public_id"),
    authorizedHandler<AuthorizedOrgRequest>(async (req, res) => {
      const users = await storage.getUsersInOrganization(req.orgId)
      // Sort users by name, putting empty names at the end
      users.sort((a, b) => {
        if (!a.name && !b.name) return 0
        if (!a.name) return 1
        if (!b.name) return -1
        return a.name.localeCompare(b.name)
      })

      // Return users with publicId instead of internal id for security
      const sanitizedUsers = users.map((user) => ({
        publicId: user.publicId,
        email: user.email,
        name: user.name,
        role: user.role,
      }))

      res.json(sanitizedUsers)
    }, "Failed to get users in organization")
  )

  // Add user to organization - requires admin role
  app.post(
    "/api/organization/:org_public_id/users",
    ...requireOrgAdmin("org_public_id"),
    authorizedHandler<AuthorizedOrgRequest>(async (req, res) => {
      const { userPublicId, role } = req.body

      // Validate user publicId format
      if (!userPublicId || !hasValidPrefix(userPublicId, "usr")) {
        res.status(400).json({
          error: "Invalid user ID format. Expected format: usr_xxxxxxxxxxxx",
        })
        return
      }

      // Look up user by public ID
      const userToAdd = await storage.getUserByPublicId(userPublicId)
      if (!userToAdd) {
        res.status(404).json({ error: "User not found" })
        return
      }

      const result = insertUserOrganizationSchema.safeParse({
        userId: userToAdd.publicId,
        organizationId: req.orgId,
        role: role || "member",
      })

      if (!result.success) {
        res.status(400).json({ error: fromZodError(result.error).toString() })
        return
      }

      const userOrganization = await storage.addUserToOrganization(result.data)
      res.json(userOrganization)
    }, "Failed to add user to organization")
  )

  // Remove user from organization - requires admin role (or self-removal)
  app.delete(
    "/api/organization/:org_public_id/users/:user_public_id",
    ...requireOrgMember("org_public_id"),
    authorizedHandler<AuthorizedOrgRequest>(async (req, res) => {
      const { user_public_id } = req.params

      // Validate user publicId format
      if (!hasValidPrefix(user_public_id, "usr")) {
        res.status(400).json({
          error: "Invalid user ID format. Expected format: usr_xxxxxxxxxxxx",
        })
        return
      }

      // Look up user by public ID
      const userToRemove = await storage.getUserByPublicId(user_public_id)
      if (!userToRemove) {
        res.status(404).json({ error: "User not found" })
        return
      }

      // Check permissions - users can remove themselves, admins/owners can remove others
      const isSelfRemoval = userToRemove.publicId === req.currentUser.publicId
      if (!isSelfRemoval && !canModifyUser(req, userToRemove.publicId)) {
        res
          .status(403)
          .json({ error: "You do not have permission to remove this user" })
        return
      }

      // Prevent removing the last owner
      if (!isSelfRemoval) {
        const userRole = await storage.getUserOrganizationRole(
          userToRemove.publicId,
          req.orgId
        )
        if (userRole?.role === "owner") {
          // Check if this is the last owner
          const allUsers = await storage.getUsersInOrganization(req.orgId)
          const ownerCount = allUsers.filter((u) => u.role === "owner").length
          if (ownerCount <= 1) {
            res.status(400).json({
              error: "Cannot remove the last owner. Transfer ownership first.",
            })
            return
          }
        }
      }

      await storage.removeUserFromOrganization(userToRemove.publicId, req.orgId)
      res.json({ success: true })
    }, "Failed to remove user from organization")
  )

  // Update user role in organization - requires owner role
  app.patch(
    "/api/organization/:org_public_id/users/:user_public_id",
    ...requireOrgOwner("org_public_id"),
    authorizedHandler<AuthorizedOrgRequest>(async (req, res) => {
      const { user_public_id } = req.params
      const { role } = req.body

      // Validate user publicId format
      if (!hasValidPrefix(user_public_id, "usr")) {
        res.status(400).json({
          error: "Invalid user ID format. Expected format: usr_xxxxxxxxxxxx",
        })
        return
      }

      if (!role || typeof role !== "string") {
        res.status(400).json({ error: "Role is required" })
        return
      }

      if (!["owner", "admin", "member"].includes(role)) {
        res.status(400).json({ error: "Invalid role" })
        return
      }

      // Look up user by public ID
      const userToUpdate = await storage.getUserByPublicId(user_public_id)
      if (!userToUpdate) {
        res.status(404).json({ error: "User not found" })
        return
      }

      const userOrganization = await storage.updateUserOrganizationRole(
        userToUpdate.publicId,
        req.orgId,
        role
      )
      res.json(userOrganization)
    }, "Failed to update user role")
  )

  // Check uniqueness of org slug - requires authentication
  app.post(
    "/api/organization/slug",
    requireAuth(),
    authorizedHandler<AuthorizedRequest>(async (req, res) => {
      const { slug } = req.body

      if (!slug || typeof slug !== "string") {
        res.status(400).json({ error: "Slug is required" })
        return
      }

      const existingOrg = await storage.getOrganizationBySlug(slug)
      if (existingOrg) {
        res.json({ error: "Slug already exists", available: false })
        return
      }

      res.json({ available: true })
    }, "Failed to check slug")
  )

  // Invite user to organization - requires admin role
  app.post(
    "/api/organization/:org_public_id/invite",
    ...requireOrgAdmin("org_public_id"),
    authorizedHandler<AuthorizedOrgRequest>(async (req, res) => {
      const { email } = req.body

      if (!email || typeof email !== "string") {
        res.status(400).json({ error: "Email is required" })
        return
      }

      // Validate email format
      const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/
      if (!emailRegex.test(email)) {
        res.status(400).json({ error: "Invalid email format" })
        return
      }

      const invitation = await storage.createInvitation(req.orgId, email)

      const inviteLink = `${process.env.APP_BASE_URL}/accept?token=${encodeURIComponent(invitation.token)}`

      try {
        await sendInviteEmail(email, inviteLink)
      } catch (emailError) {
        const errorMessage =
          emailError instanceof Error ? emailError.message : String(emailError)
        // Check if it's an email sending error
        if (
          errorMessage.includes("Postmark") ||
          errorMessage.includes("email")
        ) {
          res.status(500).json({
            error:
              "Failed to send invitation email. Please check email service configuration.",
            details: errorMessage,
          })
          return
        }
        throw emailError
      }

      res.json(true)
    }, "Failed to invite user")
  )
}

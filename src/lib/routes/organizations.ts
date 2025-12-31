import type { Express } from "express"
import { storage } from "../../storage"
import {
  insertOrganizationSchema,
  insertUserOrganizationSchema,
} from "../../shared/schema"
import { fromZodError } from "zod-validation-error"
import { sendInviteEmail } from "../email"
import {
  asyncHandler,
  withOrganization,
  withUserSub,
  OrganizationRequest,
  UserRequest,
} from "./middleware"

export function organizationRoutes(app: Express) {
  const userMiddleware = withUserSub()
  const orgMiddleware = withOrganization()

  // Get user's organizations
  app.get(
    "/api/organizations",
    userMiddleware,
    asyncHandler<UserRequest>(async (req, res) => {
      const user = await storage.getUser(req.userSub)
      if (!user) {
        res.status(404).json({ error: "User not found" })
        return
      }
      const userOrganizations = await storage.getOrganizationsByUserId(user.id)
      res.json(userOrganizations)
    }, "Failed to fetch organizations")
  )

  // Get specific organization
  app.get(
    "/api/organization/:id",
    asyncHandler(async (req, res) => {
      const orgId = parseInt(req.params.id)
      if (isNaN(orgId)) {
        res.status(400).json({ error: "Invalid organization ID" })
        return
      }

      const organization = await storage.getOrganization(orgId)
      if (!organization) {
        res.status(404).json({ error: "Organization not found" })
        return
      }

      res.json(organization)
    }, "Failed to fetch organization")
  )

  // Create new organization
  app.post(
    "/api/organizations",
    asyncHandler(async (req, res) => {
      const result = insertOrganizationSchema.safeParse(req.body)
      if (!result.success) {
        res.status(400).json({ error: fromZodError(result.error).toString() })
        return
      }

      const organization = await storage.createOrganization(result.data)
      res.json(organization)
    }, "Failed to create organization")
  )

  // Update organization
  app.put(
    "/api/organization/:org_id",
    orgMiddleware,
    asyncHandler<OrganizationRequest>(async (req, res) => {
      const result = insertOrganizationSchema.partial().safeParse(req.body)
      if (!result.success) {
        res.status(400).json({ error: fromZodError(result.error).toString() })
        return
      }

      const organization = await storage.updateOrganization(
        String(req.orgId),
        result.data
      )
      res.json(organization)
    }, "Failed to update organization")
  )

  // Delete organization
  app.delete(
    "/api/organization/:id",
    asyncHandler(async (req, res) => {
      const orgId = parseInt(req.params.id)
      if (isNaN(orgId)) {
        res.status(400).json({ error: "Invalid organization ID" })
        return
      }

      await storage.removeAllUsersFromOrganization(orgId)
      await storage.deleteOrganization(orgId)
      res.json({ success: true })
    }, "Failed to delete organization")
  )

  // Get all users in organization
  app.get(
    "/api/organization/:id/users",
    asyncHandler(async (req, res) => {
      const orgId = parseInt(req.params.id)
      if (isNaN(orgId)) {
        res.status(400).json({ error: "Invalid organization ID" })
        return
      }

      const users = await storage.getUsersInOrganization(orgId)
      res.json(users)
    }, "Failed to get users in organization")
  )

  // Add user to organization
  app.post(
    "/api/organization/:id/users",
    asyncHandler(async (req, res) => {
      const orgId = parseInt(req.params.id)
      if (isNaN(orgId)) {
        res.status(400).json({ error: "Invalid organization ID" })
        return
      }

      const result = insertUserOrganizationSchema.safeParse({
        ...req.body,
        organizationId: orgId,
      })

      if (!result.success) {
        res.status(400).json({ error: fromZodError(result.error).toString() })
        return
      }

      const userOrganization = await storage.addUserToOrganization(result.data)
      res.json(userOrganization)
    }, "Failed to add user to organization")
  )

  // Remove user from organization
  app.delete(
    "/api/organization/:id/users/:userId",
    asyncHandler(async (req, res) => {
      const orgId = parseInt(req.params.id)
      const userId = parseInt(req.params.userId)

      if (isNaN(orgId) || isNaN(userId)) {
        res.status(400).json({ error: "Invalid organization or user ID" })
        return
      }

      await storage.removeUserFromOrganization(userId, orgId)
      res.json({ success: true })
    }, "Failed to remove user from organization")
  )

  // Update user role in organization
  app.put(
    "/api/organization/:id/users/:userId/role",
    asyncHandler(async (req, res) => {
      const orgId = parseInt(req.params.id)
      const userId = parseInt(req.params.userId)

      if (isNaN(orgId) || isNaN(userId)) {
        res.status(400).json({ error: "Invalid organization or user ID" })
        return
      }

      const { role } = req.body
      if (!role || typeof role !== "string") {
        res.status(400).json({ error: "Role is required" })
        return
      }

      const userOrganization = await storage.updateUserOrganizationRole(
        userId,
        orgId,
        role
      )
      res.json(userOrganization)
    }, "Failed to update user role")
  )

  // Check uniqueness of org slug
  app.post(
    "/api/organization/slug",
    asyncHandler(async (req, res) => {
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

  // Invite user to organization
  app.post(
    "/api/organization/:id/invite",
    userMiddleware,
    asyncHandler<UserRequest>(async (req, res) => {
      const orgId = parseInt(req.params.id)
      const { email } = req.body

      if (isNaN(orgId)) {
        res.status(400).json({ error: "Invalid organization id" })
        return
      }

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

      // Check if organization exists
      const organization = await storage.getOrganization(orgId)
      if (!organization) {
        res.status(404).json({ error: "Organization not found" })
        return
      }

      // Check if user has permission to invite users to this organization
      const user = await storage.getUser(req.userSub)
      if (!user) {
        res.status(404).json({ error: "User not found" })
        return
      }

      const userOrg = await storage.getUserOrganizationRole(user.id, orgId)

      if (!userOrg) {
        res
          .status(403)
          .json({ error: "You are not a member of this organization" })
        return
      }

      // Only owners and admins can invite users
      if (userOrg.role !== "owner" && userOrg.role !== "admin") {
        res
          .status(403)
          .json({ error: "Only owners and admins can invite users" })
        return
      }

      const invitation = await storage.createInvitation(orgId, email)

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

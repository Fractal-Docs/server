import type { Express } from "express"
import { storage } from "../../storage"
import {
  insertOrganizationSchema,
  insertUserOrganizationSchema,
} from "../../shared/schema"
import { fromZodError } from "zod-validation-error"
import { getParams } from "../helpers"
import { getAuth0AccessToken, getUserByEmail, inviteUser } from "../auth0"
import { sendInviteEmail } from "../email"

export function organizationRoutes(app: Express) {
  // Get user's organizations
  app.get("/api/organizations", async (req, res) => {
    try {
      const userSub = req.headers["user-sub"] as string
      if (!userSub) {
        res.status(401).json({ error: "User sub not provided" })
        return
      }
      const user = await storage.getUser(userSub)
      if (!user) {
        res.status(404).json({ error: "User not found" })
        return
      }
      const userOrganizations = await storage.getOrganizationsByUserId(user?.id)
      res.json(userOrganizations)
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to fetch organizations"
      res.status(500).json({ error: message })
    }
  })

  // Get specific organization
  app.get("/api/organization/:id", async (req, res) => {
    try {
      const orgId = parseInt(req.params.id)
      const organization = await storage.getOrganization(orgId)

      if (!organization) {
        res.status(404).json({ error: "Organization not found" })
        return
      }

      res.json(organization)
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to fetch organization"
      res.status(500).json({ error: message })
    }
  })

  // Create new organization
  app.post("/api/organizations", async (req, res) => {
    try {
      const result = insertOrganizationSchema.safeParse(req.body)
      if (!result.success) {
        res.status(400).json({ error: fromZodError(result.error).toString() })
        return
      }

      const organization = await storage.createOrganization(result.data)

      res.json(organization)
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to create organization"
      res.status(500).json({ error: message })
    }
  })

  // Update organization
  app.put("/api/organization/:org_id", async (req, res) => {
    try {
      const { org_id } = getParams(req, res, ["org_id"])
      const result = insertOrganizationSchema.partial().safeParse(req.body)

      if (!result.success) {
        res.status(400).json({ error: fromZodError(result.error).toString() })
        return
      }

      const organization = await storage.updateOrganization(org_id, result.data)
      res.json(organization)
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to update organization"
      res.status(500).json({ error: message })
    }
  })

  // Delete organization
  app.delete("/api/organization/:id", async (req, res) => {
    try {
      const orgId = parseInt(req.params.id)
      await storage.removeAllUsersFromOrganization(orgId)
      await storage.deleteOrganization(orgId)
      res.json({ success: true })
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to delete organization"
      res.status(500).json({ error: message })
    }
  })

  // Get all users in organization
  app.get("/api/organization/:id/users", async (req, res) => {
    try {
      const orgId = parseInt(req.params.id)
      const users = await storage.getUsersInOrganization(orgId)
      res.json(users)
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to get users in organization"
      res.status(500).json({ error: message })
    }
  })

  // Add user to organization
  app.post("/api/organization/:id/users", async (req, res) => {
    try {
      const orgId = parseInt(req.params.id)
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
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to add user to organization"
      res.status(500).json({ error: message })
    }
  })

  // Remove user from organization
  app.delete("/api/organization/:id/users/:userId", async (req, res) => {
    try {
      const orgId = parseInt(req.params.id)
      const userId = parseInt(req.params.userId)

      await storage.removeUserFromOrganization(userId, orgId)
      res.json({ success: true })
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to remove user from organization"
      res.status(500).json({ error: message })
    }
  })

  // Update user role in organization
  app.put("/api/organization/:id/users/:userId/role", async (req, res) => {
    try {
      const orgId = parseInt(req.params.id)
      const userId = parseInt(req.params.userId)
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
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to update user role"
      res.status(500).json({ error: message })
    }
  })

  // Check uniqueness of org slug
  app.post("/api/organization/slug", async (req, res) => {
    try {
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
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to check slug"
      res.status(500).json({ error: message })
    }
  })

  // Invite user to organization
  app.post("/api/organization/:id/invite", async (req, res) => {
    try {
      const orgId = parseInt(req.params.id)
      const { email } = req.body

      if (!email || typeof email !== "string") {
        res.status(400).json({ error: "Email is required" })
        return
      }

      const accessToken = await getAuth0AccessToken()

      // either we find the user, or we invite them
      const userId =
        (await getUserByEmail(accessToken, email)) ||
        (await inviteUser(accessToken, email))

      const invitation = await storage.createInvitation(orgId, userId)

      const inviteLink = `${process.env.APP_BASE_URL}/accept?token=${invitation.token}`

      await sendInviteEmail(email, inviteLink)

      res.json(true)
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to invite user"
      res.status(500).json({ error: message })
    }
  })
}

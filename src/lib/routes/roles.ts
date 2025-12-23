import type { Express } from "express"
import { storage } from "src/storage"
import { getParams } from "../helpers"
import { ROLES, Role } from "src/shared/schema"
import { nanoid } from "nanoid"

export function roleRoutes(app: Express) {
  // Get all roles for an organization
  app.get("/api/organization/:org_id/roles", async (req, res) => {
    try {
      const { org_id } = getParams(req, res, ["org_id"])
      const organization = await storage.getOrganization(org_id)
      if (!organization) {
        res.status(404).json({ error: "Organization not found" })
        return
      }

      const roles = await storage.getRolesByOrganization(org_id)
      res.json(roles)
    } catch (error) {
      console.error("Error fetching roles:", error)
      res.status(500).json({ error: "Failed to fetch roles" })
    }
  })

  // Get a specific role by organization ID and role type
  app.get("/api/organization/:org_id/roles/:role_type", async (req, res) => {
    try {
      const { org_id } = getParams(req, res, ["org_id"])
      const { role_type } = req.params
      const organization = await storage.getOrganization(org_id)
      if (!organization) {
        res.status(404).json({ error: "Organization not found" })
        return
      }

      if (!ROLES.includes(role_type as Role)) {
        res.status(400).json({ error: "Invalid role type" })
        return
      }

      const role = await storage.getRoleByOrgAndType(org_id, role_type as Role)

      if (!role) {
        res.json({
          roleType: role_type,
          context: "",
        })
        return
      }

      res.json(role)
    } catch (error) {
      console.error("Error fetching role:", error)
      res.status(500).json({ error: "Failed to fetch role" })
    }
  })

  // Update a role's context
  app.put("/api/organization/:org_id/roles/:role_type", async (req, res) => {
    try {
      const { org_id } = getParams(req, res, ["org_id"])
      const { role_type } = req.params
      const organization = await storage.getOrganization(org_id)
      if (!organization) {
        res.status(404).json({ error: "Organization not found" })
        return
      }

      if (!ROLES.includes(role_type as Role)) {
        res.status(400).json({ error: "Invalid role type" })
        return
      }

      const { context } = req.body

      if (!context || typeof context !== "string") {
        res
          .status(400)
          .json({ error: "Context is required and must be a string" })
        return
      }

      let role = await storage.getRoleByOrgAndType(org_id, role_type as Role)

      if (!role) {
        // Create the role if it doesn't exist
        const roleId = nanoid()
        role = await storage.createRole({
          id: roleId,
          organizationId: org_id,
          roleType: role_type as Role,
          context,
        })
      } else {
        // Update existing role
        role = await storage.updateRole(role.id, { context })
      }

      res.json(role)
    } catch (error) {
      console.error("Error updating role:", error)
      res.status(500).json({
        error: error instanceof Error ? error.message : "Failed to update role",
      })
    }
  })
}

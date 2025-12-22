import type { Express } from "express"
import { storage } from "src/storage"
import { getParams } from "../helpers"
import { DEFAULT_ROLE_CONTEXTS } from "../roles"
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

  // Create a new role for an organization
  app.post("/api/organization/:org_id/roles", async (req, res) => {
    try {
      const { org_id } = getParams(req, res, ["org_id"])
      const organization = await storage.getOrganization(org_id)
      if (!organization) {
        res.status(404).json({ error: "Organization not found" })
        return
      }

      const { roleType, context } = req.body

      if (!roleType || !ROLES.includes(roleType)) {
        res.status(400).json({ error: "Invalid role type" })
        return
      }

      // Check if role already exists for this organization
      const existingRole = await storage.getRoleByOrgAndType(org_id, roleType)
      if (existingRole) {
        res
          .status(409)
          .json({ error: "Role already exists for this organization" })
        return
      }

      const roleId = nanoid(10)
      const newRole = await storage.createRole({
        id: roleId,
        organizationId: org_id,
        roleType,
        context: context || DEFAULT_ROLE_CONTEXTS[roleType],
      })

      res.status(201).json(newRole)
    } catch (error) {
      console.error("Error creating role:", error)
      res.status(500).json({
        error: error instanceof Error ? error.message : "Failed to create role",
      })
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
        // Return default role context if not customized yet
        res.json({
          roleType: role_type,
          context: DEFAULT_ROLE_CONTEXTS[role_type as Role],
          isDefault: true,
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
        const roleId = `${org_id}_${role_type}_${nanoid(10)}`
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

  // Delete a role (revert to default)
  app.delete("/api/organization/:org_id/roles/:role_type", async (req, res) => {
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
        res.status(404).json({ error: "Role not found" })
        return
      }

      await storage.deleteRole(role.id)

      res.json({
        success: true,
        message: "Role deleted successfully (reverted to default)",
        roleType: role_type,
        defaultContext: DEFAULT_ROLE_CONTEXTS[role_type as Role],
      })
    } catch (error) {
      console.error("Error deleting role:", error)
      res.status(500).json({
        error: error instanceof Error ? error.message : "Failed to delete role",
      })
    }
  })

  // Revert a role to its default context (alternative to delete)
  app.post(
    "/api/organization/:org_id/roles/:role_type/revert",
    async (req, res) => {
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

        const role = await storage.getRoleByOrgAndType(
          org_id,
          role_type as Role
        )
        const defaultContext = DEFAULT_ROLE_CONTEXTS[role_type as Role]

        if (!role) {
          res.json({
            success: true,
            message: "Role is already using default context",
            roleType: role_type,
            context: defaultContext,
          })
          return
        }

        // Update role with default context
        const updatedRole = await storage.updateRole(role.id, {
          context: defaultContext,
        })

        res.json({
          success: true,
          message: "Role reverted to default context",
          role: updatedRole,
        })
      } catch (error) {
        console.error("Error reverting role:", error)
        res.status(500).json({
          error:
            error instanceof Error ? error.message : "Failed to revert role",
        })
      }
    }
  )
}

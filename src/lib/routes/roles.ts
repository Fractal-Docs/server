import type { Express } from "express"
import { storage } from "src/storage"
import { ROLES, Role } from "src/shared/schema"
import { nanoid } from "nanoid"
import {
  asyncHandler,
  withOrganization,
  OrganizationRequest,
} from "./middleware"

export function roleRoutes(app: Express) {
  const orgMiddleware = withOrganization()

  // Get all roles for an organization
  app.get(
    "/api/organization/:org_id/roles",
    orgMiddleware,
    asyncHandler<OrganizationRequest>(async (req, res) => {
      const roles = await storage.getRolesByOrganization(req.orgId)
      res.json(roles)
    }, "Failed to fetch roles")
  )

  // Get a specific role by organization ID and role type
  app.get(
    "/api/organization/:org_id/roles/:role_type",
    orgMiddleware,
    asyncHandler<OrganizationRequest>(async (req, res) => {
      const { role_type } = req.params

      if (!ROLES.includes(role_type as Role)) {
        res.status(400).json({ error: "Invalid role type" })
        return
      }

      const role = await storage.getRoleByOrgAndType(
        req.orgId,
        role_type as Role
      )

      if (!role) {
        res.json({
          roleType: role_type,
          context: "",
        })
        return
      }

      res.json(role)
    }, "Failed to fetch role")
  )

  // Update a role's context
  app.put(
    "/api/organization/:org_id/roles/:role_type",
    orgMiddleware,
    asyncHandler<OrganizationRequest>(async (req, res) => {
      const { role_type } = req.params
      const { context } = req.body

      if (!ROLES.includes(role_type as Role)) {
        res.status(400).json({ error: "Invalid role type" })
        return
      }

      if (!context || typeof context !== "string") {
        res
          .status(400)
          .json({ error: "Context is required and must be a string" })
        return
      }

      let role = await storage.getRoleByOrgAndType(req.orgId, role_type as Role)

      if (!role) {
        // Create the role if it doesn't exist
        const roleId = nanoid()
        role = await storage.createRole({
          id: roleId,
          organizationId: req.orgId,
          roleType: role_type as Role,
          context,
        })
      } else {
        // Update existing role
        role = await storage.updateRole(role.id, { context })
      }

      res.json(role)
    }, "Failed to update role")
  )
}

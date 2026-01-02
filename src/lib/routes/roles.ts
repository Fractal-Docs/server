import type { Express } from "express"
import { storage } from "src/storage"
import { ROLES, Role } from "src/shared/schema"
import {
  requireOrgMember,
  requireOrgAdmin,
  authorizedHandler,
  AuthorizedOrgRequest,
} from "./authorization"

export function roleRoutes(app: Express) {
  // Get all roles for an organization - requires membership
  app.get(
    "/api/organization/:org_public_id/roles",
    ...requireOrgMember("org_public_id"),
    authorizedHandler<AuthorizedOrgRequest>(async (req, res) => {
      const roles = await storage.getRolesByOrganization(req.orgId)
      res.json(roles)
    }, "Failed to fetch roles")
  )

  // Get a specific role by organization ID and role type - requires membership
  app.get(
    "/api/organization/:org_public_id/roles/:role_type",
    ...requireOrgMember("org_public_id"),
    authorizedHandler<AuthorizedOrgRequest>(async (req, res) => {
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

  // Update a role's context - requires admin role
  app.put(
    "/api/organization/:org_public_id/roles/:role_type",
    ...requireOrgAdmin("org_public_id"),
    authorizedHandler<AuthorizedOrgRequest>(async (req, res) => {
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
        role = await storage.createRole({
          organizationId: req.orgId,
          roleType: role_type as Role,
          context,
        })
      } else {
        // Update existing role
        role = await storage.updateRole(role.publicId, { context })
      }

      res.json(role)
    }, "Failed to update role")
  )
}

import type { Express } from "express"
import { nanoid } from "nanoid"
import { storage } from "src/storage"
import {
  createReleaseDiffAnalysis,
  generateReleaseDocument,
  generateRoleDocumentWithContext,
} from "../releases"
import { getParams } from "../helpers"
import { ROLES, Role } from "src/shared/schema"
import { DEFAULT_ROLE_CONTEXTS } from "../roles"

export function releaseRoutes(app: Express) {
  app.post("/api/organization/:org_id/releases", async (req, res) => {
    try {
      const { org_id } = getParams(req, res, ["org_id"])
      const organization = await storage.getOrganization(org_id)
      if (!organization) {
        res.status(404).json({ error: "Organization not found" })
        return
      }

      const { title, prd, repoId, branch } = req.body
      const repo = await storage.getRepo(repoId)
      if (!repo) {
        res.status(404).json({ error: "No repository found" })
        return
      }

      const diffAnalysis = await createReleaseDiffAnalysis(
        organization,
        repo,
        branch
      )

      const content = await generateReleaseDocument(prd, diffAnalysis)

      const releaseId = nanoid()

      const newRelease = await storage.createRelease({
        releaseId,
        title,
        prd,
        repoId,
        branch,
        content,
      })

      // Get or create roles for the organization and generate role documents
      if (repo) {
        for (const roleType of ROLES) {
          try {
            // Get or create role for this organization
            let role = await storage.getRoleByOrgAndType(
              repo.organizationId,
              roleType
            )

            if (!role) {
              // Create role with default context if it doesn't exist
              const roleId = `${repo.organizationId}_${roleType}_${nanoid(10)}`
              role = await storage.createRole({
                id: roleId,
                organizationId: repo.organizationId,
                roleType: roleType,
                context: DEFAULT_ROLE_CONTEXTS[roleType],
              })
            }

            const document = await generateRoleDocumentWithContext(
              content,
              roleType,
              role.context
            )
            await storage.createRoleDoc({
              releaseId,
              repoId,
              roleId: role.id,
              document,
            })
          } catch (error) {
            console.error(
              `Error generating role document for ${roleType}`,
              error
            )
          }
        }
      }

      res.json(newRelease)
    } catch (error) {
      console.error("Error creating release:", error)
      res.status(500).json({
        error:
          error instanceof Error ? error.message : "Failed to create release",
      })
    }
  })

  app.get("/api/organization/:org_id/recent-releases", async (req, res) => {
    try {
      const { org_id } = getParams(req, res, ["org_id"])
      const organization = await storage.getOrganization(org_id)
      if (!organization) {
        res.status(404).json({ error: "Organization not found" })
        return
      }
      const docs = await storage.getOrganizationReleases(org_id)

      const recentDocs = docs
        .sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        )
        .slice(0, 10)

      res.json(recentDocs.filter(Boolean))
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to fetch recent documents"
      res.status(500).json({ error: message })
    }
  })

  app.get("/api/organization/:org_id/releases", async (req, res) => {
    const { org_id } = getParams(req, res, ["org_id"])
    try {
      // need to get the releases for a users repos
      const allReleases = await storage.getOrganizationReleases(org_id)

      // Filter by repoId if provided in query params
      const { repoId } = req.query
      const filteredReleases = repoId
        ? allReleases.filter((release) => release.repoId === repoId)
        : allReleases

      res.json(filteredReleases)
    } catch (error) {
      console.error("Error fetching releases:", error)
      res.status(500).json({ error: "Failed to fetch releases" })
    }
  })

  app.get("/api/organization/:org_id/releases/:id", async (req, res) => {
    try {
      const { id } = req.params
      const release = await storage.getRelease(id)

      if (!release) {
        res.status(404).json({ error: "Release not found" })
        return
      }

      res.json(release)
    } catch (error) {
      console.error("Error fetching release:", error)
      res.status(500).json({ error: "Failed to fetch release" })
    }
  })

  app.post(
    "/api/organization/:org_id/releases/:id/generate-roles",
    async (req, res) => {
      try {
        const { id, org_id } = req.params
        const { roles: selectedRoleTypes } = req.body

        const orgId = Number(org_id)
        if (isNaN(orgId)) {
          res.status(400).json({ error: "Invalid organization ID" })
          return
        }

        const organization = await storage.getOrganization(orgId)
        if (!organization) {
          res.status(404).json({ error: "Organization not found" })
          return
        }

        const release = await storage.getRelease(id)

        if (!release) {
          res.status(404).json({ error: "Release not found" })
          return
        }

        for (const roleType of selectedRoleTypes) {
          try {
            // Validate role type
            if (!ROLES.includes(roleType as Role)) {
              console.error(`Invalid role type: ${roleType}`)
              continue
            }

            // Get or create role for this organization
            let role = await storage.getRoleByOrgAndType(
              orgId,
              roleType as Role
            )

            if (!role) {
              // Create role with default context if it doesn't exist
              const roleId = `${orgId}_${roleType}_${nanoid(10)}`
              role = await storage.createRole({
                id: roleId,
                organizationId: orgId,
                roleType: roleType as Role,
                context: "",
              })
            }

            const document = await generateRoleDocumentWithContext(
              release.content,
              roleType as Role,
              role.context
            )
            await storage.upsertRoleDoc({
              releaseId: id,
              repoId: release.repoId,
              roleId: role.id,
              document,
            })
          } catch (error) {
            console.error(
              `Error generating document for role ${roleType}:`,
              error
            )
          }
        }

        res.json({ success: true })
      } catch (error) {
        console.error("Error generating role documents:", error)
        res.status(500).json({
          error:
            error instanceof Error
              ? error.message
              : "Failed to generate role documents",
        })
      }
    }
  )

  app.get(
    "/api/organization/:org_id/releases/:id/role-docs",
    async (req, res) => {
      try {
        const { id } = req.params
        const roleDocs = await storage.getRoleDocsForRelease(id)

        res.json(roleDocs)
      } catch (error) {
        console.error("Error fetching role documents:", error)
        res.status(500).json({ error: "Failed to fetch role documents" })
      }
    }
  )

  app.delete("/api/organization/:org_id/releases/:id", async (req, res) => {
    try {
      const { id } = req.params
      const release = await storage.getRelease(id)

      if (!release) {
        res.status(404).json({ error: "Release not found" })
        return
      }

      // Delete role documents first
      await storage.deleteRoleDocsForRelease(id)

      // Then delete the release
      await storage.deleteRelease(id)

      res.json({ success: true, message: "Release deleted successfully" })
    } catch (error) {
      console.error("Error deleting release:", error)
      res.status(500).json({
        error:
          error instanceof Error ? error.message : "Failed to delete release",
      })
    }
  })
}

import type { Express } from "express"
import { nanoid } from "nanoid"
import { storage } from "src/storage"
import {
  analyzeDiff,
  generateReleaseDocument,
  generateRoleDocument,
  generateRoleDocumentWithContext,
} from "../releases"
import { getParams } from "../helpers"
import { ROLES } from "src/shared/schema"

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
      const diffAnalysis = await analyzeDiff(repoId, branch)

      const releaseDocument = await generateReleaseDocument(prd, diffAnalysis)

      const releaseId = nanoid()

      const newRelease = await storage.createRelease({
        releaseId,
        title,
        prd,
        repoId,
        branch,
        diffAnalysis,
        releaseDocument,
      })

      // Save role documents separately to role_docs table
      for (const role of ROLES) {
        try {
          const document = await generateRoleDocument(releaseDocument, role)
          await storage.createRoleDoc({
            releaseId,
            repoId,
            role,
            document,
          })
        } catch (error) {
          console.error(`Error generating role document for ${role}`, error)
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
    async (req: any, res: any) => {
      try {
        const { id } = req.params
        const { roles: selectedRoles } = req.body

        const release = await storage.getRelease(id)

        if (!release) {
          return res.status(404).json({ error: "Release not found" })
        }

        for (const role of selectedRoles) {
          try {
            const document = await generateRoleDocumentWithContext(
              release.releaseDocument,
              role
            )
            await storage.upsertRoleDoc({
              releaseId: id,
              repoId: release.repoId,
              role,
              document,
            })
          } catch (error) {
            console.error(`Error generating document for role ${role}:`, error)
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

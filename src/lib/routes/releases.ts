import type { Express } from "express"
import { nanoid } from "nanoid"
import { storage } from "src/storage"
import {
  createReleaseDiffAnalysis,
  prepareReleaseDocumentation,
  prepareRoleDocumentation,
} from "../releases"
import { getParams } from "../helpers"
import { registerGenerateWorker } from "../documents"
import { enqueueTask } from "../task-manager"

export function releaseRoutes(app: Express) {
  app.post("/api/organization/:org_id/releases", async (req, res) => {
    try {
      const { org_id } = getParams(req, res, ["org_id"])
      const organization = await storage.getOrganization(org_id)
      if (!organization) {
        res.status(404).json({ error: "Organization not found" })
        return
      }

      const { title, repoId, branch, roles } = req.body
      const repo = await storage.getRepo(repoId)
      if (!repo) {
        res.status(404).json({ error: "No repository found" })
        return
      }

      const release = await storage.getReleaseByBranch(repoId, branch)
      const orgRoles = await storage.getRolesByOrganization(org_id)

      const prd = (await storage.getPrdForBranch(repoId, branch)) || {
        content: "",
      }
      const prdContent = prd.content

      const diffAnalysis = await createReleaseDiffAnalysis(
        organization,
        repo,
        branch
      )

      const { developerPrompt, userPrompt, model } =
        await prepareReleaseDocumentation(prdContent, diffAnalysis)

      // Register the worker for generating role documentation
      registerGenerateWorker(
        async ({ content, extra, jobId: id }) => {
          const { role, releaseId } = extra
          console.log(
            `Generating role documentation for role ${role}, releaseId ${releaseId}`
          )
          await storage.updateJob(id, {
            status: "completed",
          })
          await storage.removeErrorJobsByBranchAndType(repoId, branch, "role")

          if (release) {
            await storage.updateRoleDoc({
              releaseId: release.releaseId,
              repoId,
              roleId: role.id,
              document: content,
            })
            return
          }

          await storage.createRoleDoc({
            releaseId,
            repoId,
            roleId: role.id,
            document: content,
          })
        },
        async (error, { id }) => {
          await storage.updateJob(id, {
            status: "error",
            message: error instanceof Error ? error.message : String(error),
          })
        },
        "generateRoleDocumentation"
      )

      // Register the worker for generating release documentation
      registerGenerateWorker(
        async ({ content, jobId: id }) => {
          await storage.updateJob(id, {
            status: "completed",
          })
          await storage.removeErrorJobsByBranchAndType(
            repoId,
            branch,
            "release"
          )

          if (release) {
            await storage.updateRelease(release.releaseId, {
              content,
              updatedAt: new Date(),
            })
            return
          }
          const releaseId = nanoid()

          await storage.createRelease({
            releaseId,
            title,
            repoId,
            branch,
            content,
          })

          console.log("Release created")
          console.log(`Creating role documents for ${roles}`)
          for (const roleType of roles) {
            try {
              let role = orgRoles.find((r) => r.roleType === roleType)

              if (!role) {
                const id = nanoid()
                // create role
                role = await storage.createRole({
                  id,
                  organizationId: org_id,
                  roleType,
                  context: "",
                })
              }

              const roleContext = role?.context || ""
              console.log(roleType, roleContext)

              const { developerPrompt, userPrompt, model } =
                await prepareRoleDocumentation(roleType, roleContext, content)

              // enqueue a task for each role that needs generation
              const jobId = await enqueueTask("generateRoleDocumentation", {
                developerPrompt,
                userPrompt,
                model,
                // pass the role and releaseId to the role generation task
                extra: {
                  releaseId,
                  role,
                },
              })
              console.log("enqueued task for ", roleType, " at ", new Date())

              if (jobId) {
                await storage.addJob({
                  jobId,
                  repoId,
                  type: "role",
                  branch,
                  status: "pending",
                  message: `${roleType} Job started`,
                })
              }
            } catch (error) {
              console.error(
                `Error preparing documentation for role ${roleType}:`,
                error
              )
            }
          }
        },
        async (error, { id }) => {
          await storage.updateJob(id, {
            status: "error",
            message: error instanceof Error ? error.message : String(error),
          })
        }
      )

      const jobId = await enqueueTask("generateDocumentation", {
        developerPrompt,
        userPrompt,
        model,
      })
      console.log("Creating release")

      if (jobId) {
        await storage.addJob({
          jobId,
          repoId,
          type: "release",
          branch,
          status: "pending",
          message: "Job started",
        })
      }

      res.json({ jobId })
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

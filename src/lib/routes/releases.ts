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
import { getRepoById } from "./code"

const RELEASE_GENERATION = "generateReleaseDocumentation"
const ROLE_DOC_GENERATION = "generateRoleDocumentation"

const registerRoleWorker = (repoId: string, branch: string) => {
  registerGenerateWorker(
    ROLE_DOC_GENERATION,
    async ({ content, extra, jobId: id }) => {
      const { role, releaseId } = extra
      console.log(
        `Generated role documentation for role ${role?.roleType}, releaseId ${releaseId}`
      )
      await storage.updateJob(id, {
        status: "completed",
        details: {
          releaseId,
          roleId: role.id,
        },
      })
      await storage.removeJobsByBranchAndType(repoId, branch, "role", "error")

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
    }
  )
}

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

      // delete old jobs for release and role documentation
      await storage.removeJobsByBranchAndType(repoId, branch, "release")
      await storage.removeJobsByBranchAndType(repoId, branch, "role")

      const release = await storage.getReleaseByBranch(repoId, branch)
      // delete old release and role documents (cascade)
      if (release) {
        await storage.deleteRelease(release?.releaseId)
      }

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

      // Register the workers for generating role documentation
      for (let i = 0; i < roles.length; i++) {
        registerRoleWorker(repoId, branch)
      }

      // Register the worker for generating release documentation
      registerGenerateWorker(
        RELEASE_GENERATION,
        async ({ content, jobId: id }) => {
          await storage.removeJobsByBranchAndType(
            repoId,
            branch,
            "release",
            "error"
          )
          const releaseId = nanoid()
          await storage.createRelease({
            releaseId,
            title,
            repoId,
            branch,
            content,
          })
          await storage.updateJob(id, {
            status: "completed",
            details: {
              releaseId,
            },
          })

          console.log("Release created")
          console.log(`Creating role documents for ${roles.join(", ")}`)
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

              const { developerPrompt, userPrompt, model } =
                await prepareRoleDocumentation(roleType, roleContext, content)

              // enqueue a task for each role that needs generation
              const jobId = await enqueueTask(ROLE_DOC_GENERATION, {
                developerPrompt,
                userPrompt,
                model,
                // pass the role and releaseId to the role generation task
                extra: {
                  releaseId,
                  role,
                },
              })
              console.log("enqueued task for", roleType, "at", new Date())

              if (jobId) {
                await storage.addJob({
                  jobId,
                  repoId,
                  organizationId: org_id,
                  type: "role",
                  branch,
                  details: {
                    releaseId,
                    roleId: role.id,
                    roleType,
                  },
                  status: "pending",
                  message: `${roleType} documentation generation started`,
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

      const jobId = await enqueueTask(RELEASE_GENERATION, {
        developerPrompt,
        userPrompt,
        model,
      })
      console.log("Creating release")

      if (jobId) {
        await storage.addJob({
          jobId,
          repoId,
          organizationId: org_id,
          type: "release",
          branch,
          status: "pending",
          message: "Release generation started",
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

  // endpoint for generating role documents after a release has been created
  app.post(
    "/api/organization/:org_id/releases/:release_id/roles",
    async (req, res) => {
      try {
        const { release_id } = req.params
        const { org_id } = getParams(req, res, ["org_id"])
        const organization = await storage.getOrganization(org_id)
        if (!organization) {
          res.status(404).json({ error: "Organization not found" })
          return
        }
        const release = await storage.getRelease(release_id)
        if (!release) {
          res.status(404).json({ error: "Release not found" })
          return
        }
        const repo = await getRepoById(release.repoId, res)
        if (!repo) {
          res.status(404).json({ error: "Repository not found" })
          return
        }

        const { roles } = req.body

        // Register the workers for generating role documentation
        for (let i = 0; i < roles.length; i++) {
          registerRoleWorker(release.repoId, release.branch)
        }

        const orgRoles = await storage.getRolesByOrganization(org_id)

        for (const roleType of roles) {
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

          const { developerPrompt, userPrompt, model } =
            await prepareRoleDocumentation(
              roleType,
              roleContext,
              release.content
            )

          // enqueue a task for each role that needs generation
          const jobId = await enqueueTask(ROLE_DOC_GENERATION, {
            developerPrompt,
            userPrompt,
            model,
            // pass the role and releaseId to the role generation task
            extra: {
              releaseId: release_id,
              role,
            },
          })

          if (jobId) {
            await storage.addJob({
              jobId,
              organizationId: org_id,
              repoId: release.repoId,
              type: "role",
              branch: release.branch,
              status: "pending",
              message: `${roleType} document generation started`,
              details: {
                roleType,
              },
            })
          }
        }

        res.json({ success: true })
      } catch (error) {
        console.error("Error creating role documents:", error)
        res.status(500).json({
          error:
            error instanceof Error
              ? error.message
              : "Failed to create role documents",
        })
      }
    }
  )

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

  app.get("/api/organization/:org_id/pending-releases", async (req, res) => {
    try {
      const { org_id } = getParams(req, res, ["org_id"])
      const organization = await storage.getOrganization(org_id)
      if (!organization) {
        res.status(404).json({ error: "Organization not found" })
        return
      }
      // get jobs status
      const jobs = await storage.getJobs(org_id, ["role", "release"])
      res.json(jobs)
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to fetch pending releases"
      res.status(500).json({ error: message })
    }
  })

  app.get("/api/organization/:org_id/releases", async (req, res) => {
    try {
      const { org_id } = getParams(req, res, ["org_id"])
      const organization = await storage.getOrganization(org_id)
      if (!organization) {
        res.status(404).json({ error: "Organization not found" })
        return
      }
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

  app.get(
    "/api/organization/:org_id/repos/:repo_id/releases/check",
    async (req, res) => {
      try {
        const { org_id, repo_id, branch } = getParams(req, res, [
          "org_id",
          "repo_id",
          "branch",
        ])
        const organization = await storage.getOrganization(org_id)
        if (!organization) {
          res.status(404).json({ error: "Organization not found" })
          return
        }
        const repo = await getRepoById(repo_id, res)
        if (!repo) {
          res.status(404).json({ error: "Repo not found" })
          return
        } else if (repo.organizationId !== organization.id) {
          res.status(403).json({ error: "Repo not part of organization" })
          return
        }
        const release = await storage.getReleaseByBranch(repo_id, branch)

        if (!release) {
          res.json({ exists: false })
          return
        }

        res.json({ exists: true, release })
      } catch (error) {
        console.error("Error fetching release:", error)
        res.status(500).json({ error: "Failed to fetch release" })
      }
    }
  )

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

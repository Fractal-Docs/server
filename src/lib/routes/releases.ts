import type { Express } from "express"
import { nanoid } from "nanoid"
import { storage } from "src/storage"
import {
  createReleaseDiffAnalysis,
  prepareReleaseDocumentation,
  prepareRoleDocumentation,
} from "../releases"
import { registerGenerateWorker } from "../documents"
import { enqueueTask } from "../task-manager"
import {
  asyncHandler,
  withOrganization,
  withRepo,
  RepoRequest,
  OrganizationRequest,
  getRepoById,
  validateRepoOrganization,
} from "./middleware"
import type { Role } from "src/shared/schema"

const RELEASE_GENERATION = "generateReleaseDocumentation"
const ROLE_DOC_GENERATION = "generateRoleDocumentation"

// Common worker error handler
function createWorkerErrorHandler() {
  return async (error: unknown, { id }: { id: string }) => {
    await storage.updateJob(id, {
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    })
  }
}

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
    createWorkerErrorHandler()
  )
}

// Helper to generate role documents for a release
async function generateRoleDocuments(
  orgId: number,
  repoId: string,
  branch: string,
  releaseId: string,
  releaseContent: string,
  roles: string[]
) {
  const orgRoles = await storage.getRolesByOrganization(orgId)

  for (const roleType of roles) {
    try {
      let role = orgRoles.find((r) => r.roleType === roleType)

      if (!role) {
        const id = nanoid()
        role = await storage.createRole({
          id,
          organizationId: orgId,
          roleType: roleType as Role,
          context: "",
        })
      }

      const roleContext = role?.context || ""

      const { developerPrompt, userPrompt, model } =
        await prepareRoleDocumentation(
          roleType as Role,
          roleContext,
          releaseContent
        )

      const jobId = await enqueueTask(ROLE_DOC_GENERATION, {
        developerPrompt,
        userPrompt,
        model,
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
          organizationId: orgId,
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
}

export function releaseRoutes(app: Express) {
  const orgMiddleware = withOrganization()
  const repoMiddleware = [orgMiddleware, withRepo()]

  // Create a new release
  app.post(
    "/api/organization/:org_id/releases",
    orgMiddleware,
    asyncHandler<OrganizationRequest>(async (req, res) => {
      const { organization, orgId } = req
      const { title, repoId, branch, roles } = req.body

      const repo = await storage.getRepo(repoId)
      if (!repo) {
        res.status(404).json({ error: "No repository found" })
        return
      }

      // delete old jobs for release and role documentation
      await storage.removeJobsByBranchAndType(repoId, branch, "release")
      await storage.removeJobsByBranchAndType(repoId, branch, "role")

      const existingRelease = await storage.getReleaseByBranch(repoId, branch)
      if (existingRelease) {
        await storage.deleteRelease(existingRelease.releaseId)
      }

      const prd = (await storage.getPrdForBranch(repoId, branch)) || {
        content: "",
      }

      const diffAnalysis = await createReleaseDiffAnalysis(
        organization,
        repo,
        branch
      )

      const { developerPrompt, userPrompt, model } =
        await prepareReleaseDocumentation(prd.content, diffAnalysis)

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

          await generateRoleDocuments(
            orgId,
            repoId,
            branch,
            releaseId,
            content,
            roles
          )
        },
        createWorkerErrorHandler()
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
          organizationId: orgId,
          type: "release",
          branch,
          status: "pending",
          message: "Release generation started",
        })
      }

      res.json({ jobId })
    }, "Failed to create release")
  )

  // Generate role documents for existing release
  app.post(
    "/api/organization/:org_id/releases/:release_id/role-docs",
    orgMiddleware,
    asyncHandler<OrganizationRequest>(async (req, res) => {
      const { release_id } = req.params
      const { organization, orgId } = req

      const release = await storage.getRelease(release_id)
      if (!release) {
        res.status(404).json({ error: "Release not found" })
        return
      }

      const repo = await getRepoById(release.repoId, res)
      if (!repo) return

      if (!validateRepoOrganization(repo, organization, res)) return

      const { roles } = req.body
      if (!Array.isArray(roles)) {
        res.status(400).json({ error: "roles must be an array" })
        return
      }

      // Register the workers for generating role documentation
      for (let i = 0; i < roles.length; i++) {
        registerRoleWorker(release.repoId, release.branch)
      }

      await generateRoleDocuments(
        orgId,
        release.repoId,
        release.branch,
        release_id,
        release.content,
        roles
      )

      res.json({ success: true })
    }, "Failed to create role documents")
  )

  // Get recent releases for organization
  app.get(
    "/api/organization/:org_id/recent-releases",
    orgMiddleware,
    asyncHandler<OrganizationRequest>(async (req, res) => {
      const docs = await storage.getOrganizationReleases(req.orgId)

      const recentDocs = docs
        .sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        )
        .slice(0, 10)

      res.json(recentDocs.filter(Boolean))
    }, "Failed to fetch recent releases")
  )

  // Get pending releases for organization
  app.get(
    "/api/organization/:org_id/pending-releases",
    orgMiddleware,
    asyncHandler<OrganizationRequest>(async (req, res) => {
      const jobs = await storage.getJobs(req.orgId, ["role", "release"])
      res.json(jobs)
    }, "Failed to fetch pending releases")
  )

  // Get all releases for organization
  app.get(
    "/api/organization/:org_id/releases",
    orgMiddleware,
    asyncHandler<OrganizationRequest>(async (req, res) => {
      const allReleases = await storage.getOrganizationReleases(req.orgId)

      // Filter by repoId if provided in query params
      const { repoId } = req.query
      const filteredReleases = repoId
        ? allReleases.filter((release) => release.repoId === repoId)
        : allReleases

      res.json(filteredReleases)
    }, "Failed to fetch releases")
  )

  // Check if release exists for repo/branch
  app.get(
    "/api/organization/:org_id/repos/:repo_id/releases/check",
    ...repoMiddleware,
    asyncHandler<RepoRequest>(async (req, res) => {
      const release = await storage.getReleaseByBranch(req.repoId, req.branch)

      if (!release) {
        res.json({ exists: false })
        return
      }

      res.json({ exists: true, release })
    }, "Failed to check release")
  )

  // Get a specific release
  app.get(
    "/api/organization/:org_id/releases/:id",
    orgMiddleware,
    asyncHandler<OrganizationRequest>(async (req, res) => {
      const { id } = req.params
      const release = await storage.getRelease(id)

      if (!release) {
        res.status(404).json({ error: "Release not found" })
        return
      }

      res.json(release)
    }, "Failed to fetch release")
  )

  // Get role docs for a release
  app.get(
    "/api/organization/:org_id/releases/:id/role-docs",
    orgMiddleware,
    asyncHandler<OrganizationRequest>(async (req, res) => {
      const { id } = req.params
      const roleDocs = await storage.getRoleDocsForRelease(id)
      res.json(roleDocs)
    }, "Failed to fetch role documents")
  )

  // Delete a release
  app.delete(
    "/api/organization/:org_id/releases/:id",
    orgMiddleware,
    asyncHandler<OrganizationRequest>(async (req, res) => {
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
    }, "Failed to delete release")
  )
}

import type { Express } from "express"
import { storage } from "src/storage"
import {
  createReleaseDiffAnalysis,
  prepareReleaseDocumentation,
  prepareRoleDocumentation,
} from "../releases"
import { registerGenerateWorker } from "../documents"
import { enqueueTask } from "../task-manager"
import {
  requireOrgMember,
  requireOrgAdmin,
  authorizedHandler,
  verifyResourceOwnership,
  AuthorizedOrgRequest,
} from "./authorization"
import { withRepo, RepoRequest, createWorkerErrorHandler } from "./middleware"
import { hasValidPrefix } from "../public-ids"
import type { Role } from "src/shared/schema"

const RELEASE_GENERATION = "generateReleaseDocumentation"
const ROLE_DOC_GENERATION = "generateRoleDocumentation"

const registerRoleWorker = (repoPublicId: string, branch: string) => {
  registerGenerateWorker(
    ROLE_DOC_GENERATION,
    async ({ content, extra, jobId: id }) => {
      const { role, releasePublicId } = extra
      console.log(
        `Generated role documentation for role ${role?.roleType}, releasePublicId ${releasePublicId}`
      )
      await storage.updateJob(id, {
        status: "completed",
        details: {
          releasePublicId,
          rolePublicId: role.publicId,
        },
      })
      await storage.removeJobsByBranchAndType(
        repoPublicId,
        branch,
        "role",
        "error"
      )

      await storage.createRoleDoc({
        releasePublicId,
        repoPublicId,
        rolePublicId: role.publicId,
        document: content,
      })
    },
    createWorkerErrorHandler()
  )
}

// Helper to generate role documents for a release
async function generateRoleDocuments(
  orgId: string,
  repoPublicId: string,
  branch: string,
  releasePublicId: string,
  releaseContent: string,
  roles: string[]
) {
  const orgRoles = await storage.getRolesByOrganization(orgId)

  for (const roleType of roles) {
    try {
      let role = orgRoles.find((r) => r.roleType === roleType)

      if (!role) {
        role = await storage.createRole({
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
          releasePublicId,
          role,
        },
      })

      console.log("enqueued task for", roleType, "at", new Date())

      if (jobId) {
        await storage.addJob({
          jobId,
          repoPublicId,
          organizationId: orgId,
          type: "role",
          branch,
          details: {
            releasePublicId,
            rolePublicId: role.publicId,
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
  // Create a new release - requires membership
  app.post(
    "/api/organization/:org_public_id/releases",
    ...requireOrgMember("org_public_id"),
    authorizedHandler<AuthorizedOrgRequest>(async (req, res) => {
      const { organization, orgId } = req
      const { title, repoPublicId, branch, roles } = req.body

      // Validate repo publicId format
      if (!repoPublicId || !hasValidPrefix(repoPublicId, "repo")) {
        res.status(400).json({
          error:
            "Invalid repository ID format. Expected format: repo_xxxxxxxxxxxx",
        })
        return
      }

      const repo = await storage.getRepoByPublicId(repoPublicId)
      if (!verifyResourceOwnership(repo, req, res, "Repository")) {
        return
      }

      // delete old jobs for release and role documentation
      await storage.removeJobsByBranchAndType(repoPublicId, branch, "release")
      await storage.removeJobsByBranchAndType(repoPublicId, branch, "role")

      const existingRelease = await storage.getReleaseByBranch(
        repoPublicId,
        branch
      )
      if (existingRelease) {
        await storage.deleteRelease(existingRelease.publicId)
      }

      const prd = (await storage.getPrdForBranch(repoPublicId, branch)) || {
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
        registerRoleWorker(repoPublicId, branch)
      }

      // Register the worker for generating release documentation
      registerGenerateWorker(
        RELEASE_GENERATION,
        async ({ content, jobId: id }) => {
          await storage.removeJobsByBranchAndType(
            repoPublicId,
            branch,
            "release",
            "error"
          )
          const release = await storage.createRelease({
            title,
            repoPublicId,
            branch,
            content,
          })
          await storage.updateJob(id, {
            status: "completed",
            details: {
              releasePublicId: release.publicId,
            },
          })

          console.log("Release created")
          console.log(`Creating role documents for ${roles.join(", ")}`)

          await generateRoleDocuments(
            orgId,
            repoPublicId,
            branch,
            release.publicId,
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
          repoPublicId,
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

  // Generate role documents for existing release - requires membership
  app.post(
    "/api/organization/:org_public_id/releases/:release_public_id/role-docs",
    ...requireOrgMember("org_public_id"),
    authorizedHandler<AuthorizedOrgRequest>(async (req, res) => {
      const { release_public_id } = req.params
      const { orgId } = req

      if (!hasValidPrefix(release_public_id, "rel")) {
        res.status(400).json({
          error: "Invalid release ID format. Expected format: rel_xxxxxxxxxxxx",
        })
        return
      }

      const release = await storage.getRelease(release_public_id)
      if (!release) {
        res.status(404).json({ error: "Release not found" })
        return
      }

      const repo = await storage.getRepoByPublicId(release.repoPublicId)
      if (!verifyResourceOwnership(repo, req, res, "Release")) {
        return
      }

      const { roles } = req.body
      if (!Array.isArray(roles)) {
        res.status(400).json({ error: "roles must be an array" })
        return
      }

      // Register the workers for generating role documentation
      for (let i = 0; i < roles.length; i++) {
        registerRoleWorker(release.repoPublicId, release.branch)
      }

      await generateRoleDocuments(
        orgId,
        release.repoPublicId,
        release.branch,
        release.publicId,
        release.content,
        roles
      )

      res.json({ success: true })
    }, "Failed to create role documents")
  )

  // Get recent releases for organization - requires membership
  app.get(
    "/api/organization/:org_public_id/recent-releases",
    ...requireOrgMember("org_public_id"),
    authorizedHandler<AuthorizedOrgRequest>(async (req, res) => {
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

  // Get pending releases for organization - requires membership
  app.get(
    "/api/organization/:org_public_id/pending-releases",
    ...requireOrgMember("org_public_id"),
    authorizedHandler<AuthorizedOrgRequest>(async (req, res) => {
      const jobs = await storage.getJobs(req.orgId, ["role", "release"])
      res.json(jobs)
    }, "Failed to fetch pending releases")
  )

  // Get all releases for organization - requires membership
  app.get(
    "/api/organization/:org_public_id/releases",
    ...requireOrgMember("org_public_id"),
    authorizedHandler<AuthorizedOrgRequest>(async (req, res) => {
      const allReleases = await storage.getOrganizationReleases(req.orgId)

      // Filter by repoPublicId if provided in query params
      const { repoPublicId } = req.query
      const filteredReleases = repoPublicId
        ? allReleases.filter((release) => release.repoPublicId === repoPublicId)
        : allReleases

      res.json(filteredReleases)
    }, "Failed to fetch releases")
  )

  // Check if release exists for repo/branch - requires membership
  app.get(
    "/api/organization/:org_public_id/repos/:repo_public_id/releases/check",
    ...requireOrgMember("org_public_id"),
    withRepo(),
    authorizedHandler<RepoRequest>(async (req, res) => {
      // req.repoPublicId is the internal public ID
      const release = await storage.getReleaseByBranch(
        req.repoPublicId,
        req.branch
      )

      if (!release) {
        res.json({ exists: false })
        return
      }

      res.json({ exists: true, release })
    }, "Failed to check release")
  )

  // Get a specific release - requires membership
  app.get(
    "/api/organization/:org_public_id/releases/:release_public_id",
    ...requireOrgMember("org_public_id"),
    authorizedHandler<AuthorizedOrgRequest>(async (req, res) => {
      const { release_public_id } = req.params

      if (!hasValidPrefix(release_public_id, "rel")) {
        res.status(400).json({
          error: "Invalid release ID format. Expected format: rel_xxxxxxxxxxxx",
        })
        return
      }

      const release = await storage.getRelease(release_public_id)

      if (!release) {
        res.status(404).json({ error: "Release not found" })
        return
      }

      // Verify release belongs to a repo in this organization
      const repo = await storage.getRepoByPublicId(release.repoPublicId)
      if (!verifyResourceOwnership(repo, req, res, "Release")) {
        return
      }

      res.json(release)
    }, "Failed to fetch release")
  )

  // Get role docs for a release - requires membership
  app.get(
    "/api/organization/:org_public_id/releases/:release_public_id/role-docs",
    ...requireOrgMember("org_public_id"),
    authorizedHandler<AuthorizedOrgRequest>(async (req, res) => {
      const { release_public_id } = req.params

      if (!hasValidPrefix(release_public_id, "rel")) {
        res.status(400).json({
          error: "Invalid release ID format. Expected format: rel_xxxxxxxxxxxx",
        })
        return
      }

      // Verify release exists and belongs to org
      const release = await storage.getRelease(release_public_id)
      if (!release) {
        res.status(404).json({ error: "Release not found" })
        return
      }

      const repo = await storage.getRepoByPublicId(release.repoPublicId)
      if (!verifyResourceOwnership(repo, req, res, "Release")) {
        return
      }

      const roleDocs = await storage.getRoleDocsForRelease(release_public_id)
      res.json(roleDocs)
    }, "Failed to fetch role documents")
  )

  // Delete a release - requires admin role
  app.delete(
    "/api/organization/:org_public_id/releases/:release_public_id",
    ...requireOrgAdmin("org_public_id"),
    authorizedHandler<AuthorizedOrgRequest>(async (req, res) => {
      const { release_public_id } = req.params

      if (!hasValidPrefix(release_public_id, "rel")) {
        res.status(400).json({
          error: "Invalid release ID format. Expected format: rel_xxxxxxxxxxxx",
        })
        return
      }

      const release = await storage.getRelease(release_public_id)

      if (!release) {
        res.status(404).json({ error: "Release not found" })
        return
      }

      // Verify release belongs to a repo in this organization
      const repo = await storage.getRepoByPublicId(release.repoPublicId)
      if (!verifyResourceOwnership(repo, req, res, "Release")) {
        return
      }

      // Delete role documents first
      await storage.deleteRoleDocsForRelease(release_public_id)

      // Then delete the release
      await storage.deleteRelease(release_public_id)

      res.json({ success: true, message: "Release deleted successfully" })
    }, "Failed to delete release")
  )
}

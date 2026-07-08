import type { Express } from "express"

import { storage } from "../../storage"
import {
  getRepoBranches,
  listRepoFileSystem,
  listOrganizationRepos,
  listUserRepos,
} from "../github"
import { getOrigin, getUserSub } from "../helpers"
import {
  asyncHandler,
  withOrganizationBySlug,
  requireGitHubAuth,
  OrgSlugRequest,
} from "./middleware"
import { hasValidPrefix } from "../public-ids"
import { z } from "zod"
import { insertGithubRepoSchema } from "../../shared/schema"

interface GithubTokenResponse {
  access_token?: string
  error?: string
  error_description?: string
}

// publicId/organizationId are server-assigned (generated in
// storage.createRepo / taken from the org-slug context), not client input.
const importReposRequestSchema = z.object({
  repositories: z.array(
    insertGithubRepoSchema.omit({ publicId: true, organizationId: true })
  ),
})

export function githubRoutes(app: Express) {
  const orgSlugMiddleware = withOrganizationBySlug()
  const githubAuthMiddleware = [orgSlugMiddleware, requireGitHubAuth()]

  // GitHub OAuth routes
  app.get("/api/github/login", (req, res) => {
    const { origin, normalizedOrigin } = getOrigin(req, res)
    if (!origin || !normalizedOrigin) {
      return
    }
    const redirectUri = origin.startsWith("https")
      ? `https://${normalizedOrigin}/repos`
      : `http://${normalizedOrigin}/repos`
    const githubAuthUrl = `https://github.com/login/oauth/authorize?client_id=${process.env.GITHUB_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=repo`
    res.json({ url: githubAuthUrl })
  })

  app.get(
    "/api/github/complete-oauth",
    asyncHandler(async (req, res) => {
      const { code, orgSlug } = req.query as {
        code?: string
        orgSlug?: string
      }

      if (!code || typeof code !== "string") {
        res.status(400).json({ error: "No code provided" })
        return
      }

      const userSub = getUserSub(req, res)
      if (!userSub) {
        return
      }

      const { origin, normalizedOrigin } = getOrigin(req, res)
      if (!origin || !normalizedOrigin) {
        return
      }

      const redirectUri = origin.startsWith("https")
        ? `https://${normalizedOrigin}/repos`
        : `http://${normalizedOrigin}/repos`

      const tokenRes = await fetch(
        "https://github.com/login/oauth/access_token",
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            client_id: process.env.GITHUB_CLIENT_ID,
            client_secret: process.env.GITHUB_CLIENT_SECRET,
            code,
            redirect_uri: redirectUri,
          }),
        }
      )

      if (!tokenRes.ok) {
        throw new Error(`GitHub token exchange failed: ${tokenRes.statusText}`)
      }

      const data = (await tokenRes.json()) as GithubTokenResponse

      if (data.error) {
        throw new Error(data.error_description || data.error)
      }

      if (!data.access_token) {
        throw new Error("No access token received from GitHub")
      }

      const user = await storage.getUser(userSub)
      if (!user) {
        throw new Error("User not found")
      }

      await storage.updateOrganization(orgSlug as string, {
        accessToken: data.access_token,
      })

      res.json({ success: true })
    }, "Failed to authenticate with GitHub")
  )

  // Github App routes
  app.get("/api/github/app/install/start", (_, res) => {
    const githubAppSlug = process.env.GITHUB_APP_SLUG
    res.json({
      url: `https://github.com/apps/${githubAppSlug}/installations/new`,
    })
  })

  app.get(
    "/api/github/app/install/callback",
    asyncHandler(async (req, res) => {
      const { installation_id, orgSlug } = req.query
      const organization = await storage.getOrganizationBySlug(
        orgSlug as string
      )
      if (!organization) {
        res.status(404).json({ error: "Organization not found" })
        return
      }

      await storage.updateOrganization(orgSlug as string, {
        installationId: parseInt(installation_id as string),
      })

      res.json({ success: true })
    }, "Failed to complete GitHub app installation")
  )

  // Get available repos (requires GitHub auth)
  app.get(
    "/api/github/available-repos",
    ...githubAuthMiddleware,
    asyncHandler<OrgSlugRequest>(async (req, res) => {
      const { organization } = req

      const availableRepos = organization.accessToken
        ? await listUserRepos(organization.accessToken)
        : organization.installationId
          ? await listOrganizationRepos(organization.installationId)
          : []

      // Filter out already imported repos
      const existingRepos = await storage.getRepos(organization.publicId)
      const existingRepoIds = new Set(existingRepos.map((r) => r.repoId))

      const filteredRepos = availableRepos.filter(
        (repo) => !existingRepoIds.has(String(repo.repoId))
      )

      res.json(filteredRepos)
    }, "Failed to fetch available repositories")
  )

  // Check GitHub auth status
  app.get(
    "/api/github/auth",
    orgSlugMiddleware,
    asyncHandler<OrgSlugRequest>(async (req, res) => {
      const { organization } = req
      res.json(!!organization.accessToken || !!organization.installationId)
    }, "Failed to get GitHub auth status")
  )

  // Import repos
  app.post(
    "/api/github/import-repos",
    orgSlugMiddleware,
    asyncHandler<OrgSlugRequest>(async (req, res) => {
      const { organization } = req

      const result = importReposRequestSchema.safeParse(req.body)
      if (!result.success) {
        res.status(400).json({
          error: "Invalid repositories format",
          details: result.error.issues,
        })
        return
      }
      const { repositories } = result.data

      const existingRepos = await storage.getRepos(organization.publicId)
      const existingRepoIds = new Set(existingRepos.map((r) => r.repoId))

      const filteredRepos = repositories.filter(
        (repo) => !existingRepoIds.has(repo.repoId)
      )

      const createdRepos = await Promise.all(
        filteredRepos.map((repo) =>
          storage.createRepo({ ...repo, organizationId: organization.publicId })
        )
      )

      // Return repos with publicId, not internal details
      const sanitizedRepos = createdRepos.map((repo) => ({
        publicId: repo.publicId,
        name: repo.name,
        fullName: repo.fullName,
        owner: repo.owner,
        fileFilterRegex: repo.fileFilterRegex,
        createdAt: repo.createdAt,
      }))

      res.json(sanitizedRepos)
    }, "Failed to import repositories")
  )

  // Get repo files - uses repo publicId
  app.get(
    "/api/github/repos/:repo_public_id/files",
    orgSlugMiddleware,
    asyncHandler<OrgSlugRequest>(async (req, res) => {
      const { organization } = req
      const { repo_public_id } = req.params
      const branch = (req.query.branch as string) || "main"

      // Validate publicId format
      if (!hasValidPrefix(repo_public_id, "repo")) {
        res.status(400).json({
          error:
            "Invalid repository ID format. Expected format: repo_xxxxxxxxxxxx",
        })
        return
      }

      const repo = await storage.getRepoByPublicId(repo_public_id)
      if (!repo) {
        res.status(404).json({ error: "Repository not found" })
        return
      }

      // Verify repo belongs to this organization
      if (repo.organizationId !== organization.publicId) {
        res.status(404).json({ error: "Repository not found" })
        return
      }

      const fileSystem = await listRepoFileSystem(organization, repo, branch)
      res.status(200).json(fileSystem)
    }, "Failed to list repository files")
  )

  // Get repo branches - uses repo publicId
  app.get(
    "/api/github/repos/:repo_public_id/branches",
    orgSlugMiddleware,
    asyncHandler<OrgSlugRequest>(async (req, res) => {
      const { organization } = req
      const { repo_public_id } = req.params

      // Validate publicId format
      if (!hasValidPrefix(repo_public_id, "repo")) {
        res.status(400).json({
          error:
            "Invalid repository ID format. Expected format: repo_xxxxxxxxxxxx",
        })
        return
      }

      const repo = await storage.getRepoByPublicId(repo_public_id)
      if (!repo) {
        res.status(404).json({ error: "Repository not found" })
        return
      }

      // Verify repo belongs to this organization
      if (repo.organizationId !== organization.publicId) {
        res.status(404).json({ error: "Repository not found" })
        return
      }

      const branches = await getRepoBranches(organization, repo)
      res.json(branches)
    }, "Failed to list repository branches")
  )
}

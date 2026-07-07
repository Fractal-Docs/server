import type { Express } from "express"

import { storage } from "../../storage"
import { prepareDocumentation } from "../documents"
import { compareBranchToDefaultBranch } from "../github"
import { enqueueTask, getTaskStatus } from "../task-manager"
import {
  requireOrgMember,
  authorizedHandler,
  AuthorizedOrgRequest,
} from "./authorization"
import { withRepo, RepoRequest } from "./middleware"

export function documentsRoutes(app: Express) {
  // Generate documentation - requires membership
  app.post(
    "/api/organization/:org_public_id/repos/:repo_public_id/generate",
    ...requireOrgMember("org_public_id"),
    withRepo(),
    authorizedHandler<RepoRequest>(async (req, res) => {
      const { repoPublicId, branch, orgId } = req

      const relevantFiles = await storage.getRepoFiles(repoPublicId, branch)

      if (!relevantFiles.length) {
        res.status(404).json({ error: "No analyzed files found" })
        return
      }

      // Try to get CFG data if it exists
      let cfgContent = ""
      try {
        const cfgDocs = await storage.getRepoDocsByBranch(repoPublicId, branch)
        const cfgDoc = cfgDocs.find((doc) => doc.docType === "cfg")
        if (cfgDoc) {
          cfgContent = cfgDoc.content
        }
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : String(error)
        console.log(
          `No CFG data found, proceeding without it. Error: ${errorMessage}`
        )
      }

      // Generate documentation using OpenAI
      const fileContents = relevantFiles
        .filter((file) => file !== undefined)
        .map(
          (file) =>
            `File: ${file!.filePath}\n\n${JSON.stringify(file!.metadata, null, 2)}\n\nContent:\n${file!.content || "No content available"}`
        )
        .join("\n\n")

      // If we have CFG data, include it with file contents
      const codeWithCfg = cfgContent
        ? `${fileContents}\n\n${cfgContent}`
        : fileContents

      const prd = await storage.getPrdForBranch(repoPublicId, branch)
      const businessContext = prd
        ? `PRD Business Context: ${prd?.businessContext}\n\n PRD Content: ${prd?.content}`
        : ""

      const { developerPrompt, userPrompt, model } = await prepareDocumentation(
        codeWithCfg,
        businessContext
      )

      const generatedFrom = relevantFiles.map((f) => f!.filePath)

      const jobId = await enqueueTask("generateDocumentation", {
        developerPrompt,
        userPrompt,
        model,
        extra: {
          repoPublicId,
          branch,
          docType: "overview",
          title: "Repo Documentation",
          generatedFrom,
        },
      })

      if (jobId) {
        await storage.addJob({
          jobId,
          repoPublicId,
          organizationId: orgId,
          type: "generate",
          branch,
          status: "pending",
          message: "Job started",
        })
      }

      res.json({ jobId })
    }, "Failed to generate documentation")
  )

  // Generate change documentation (compare branch) - requires membership
  app.post(
    "/api/organization/:org_public_id/repos/:repo_public_id/compare",
    ...requireOrgMember("org_public_id"),
    withRepo(),
    authorizedHandler<RepoRequest>(async (req, res) => {
      const { organization, repo, repoPublicId, branch, orgId } = req
      const docType = "delta"

      const response = await compareBranchToDefaultBranch(
        organization,
        repo,
        branch
      )

      const relevantFiles =
        response.data?.files?.map(
          ({ filename, status, additions, deletions, changes, patch }) => ({
            filename,
            status,
            additions,
            deletions,
            changes,
            patch,
          })
        ) || []

      const fileContents = relevantFiles
        .filter((file) => file !== undefined)
        .map(
          (file) =>
            `File: ${file!.filename}\n\n${JSON.stringify(
              {
                status: file!.status,
                additions: file!.additions,
                deletions: file!.deletions,
                changes: file!.changes,
              },
              null,
              2
            )}\n\nPatch:\n${file!.patch || "No content available"}`
        )
        .join("\n\n")

      const prd = await storage.getPrdForBranch(repoPublicId, branch)
      const businessContext = prd
        ? `PRD Business Context: ${prd?.businessContext}\n\n PRD Content: ${prd?.content}`
        : ""

      const { developerPrompt, userPrompt, model } = await prepareDocumentation(
        fileContents,
        businessContext
      )

      const generatedFrom = relevantFiles.map((f) => f!.filename)

      const jobId = await enqueueTask("generateDocumentation", {
        developerPrompt,
        userPrompt,
        model,
        extra: {
          repoPublicId,
          branch,
          docType,
          title: `Delta Documentation: ${branch}`,
          generatedFrom,
        },
      })

      if (jobId) {
        await storage.addJob({
          jobId,
          repoPublicId,
          organizationId: orgId,
          type: "generate",
          branch,
          status: "pending",
          message: "Job started",
        })
      }

      res.json({ jobId })
    }, "Failed to generate change documentation")
  )

  // Get docs for a repo - requires membership
  app.get(
    "/api/organization/:org_public_id/repos/:repo_public_id/docs",
    ...requireOrgMember("org_public_id"),
    withRepo(),
    authorizedHandler<RepoRequest>(async (req, res) => {
      const docs = await storage.getRepoDocsByBranch(
        req.repoPublicId,
        req.branch
      )

      // Sort by updatedAt to get the most recent doc
      const sortedDocs = docs.sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      )

      if (!sortedDocs.length) {
        res.status(404).json({
          error: "No documentation found for this repository",
        })
        return
      }

      res.json(sortedDocs)
    }, "Failed to fetch repository documentation")
  )

  // Check for any job status - requires membership
  app.get(
    "/api/organization/:org_public_id/repos/:repo_public_id/docs_status",
    ...requireOrgMember("org_public_id"),
    withRepo(),
    authorizedHandler<RepoRequest>(async (req, res) => {
      const jobs = await storage.getJobsByBranch(req.repoPublicId, req.branch)
      res.json(jobs)
    }, "Failed to fetch repository documentation status")
  )

  // Check for specific job status - requires membership
  app.get(
    "/api/organization/:org_public_id/repos/:repo_public_id/docs_status/:job_id",
    ...requireOrgMember("org_public_id"),
    withRepo(),
    authorizedHandler<RepoRequest>(async (req, res) => {
      const status = await getTaskStatus(
        "generateDocumentation",
        req.params.job_id
      )
      if (!status) {
        res.status(404).json({ error: "Not found" })
        return
      }
      res.json(status)
    }, "Failed to get task status")
  )

  // Get recent documents for organization - requires membership
  app.get(
    "/api/organization/:org_public_id/recent-documents",
    ...requireOrgMember("org_public_id"),
    authorizedHandler<AuthorizedOrgRequest>(async (req, res) => {
      const docs = await storage.getOrganizationDocs(req.orgId)
      const recentDocs = docs
        .filter((doc) => doc.docType !== "cfg")
        .sort(
          (a, b) =>
            new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        )
        .slice(0, 10)

      res.json(recentDocs.filter(Boolean))
    }, "Failed to fetch recent documents")
  )
}

import type { Express } from "express"

import { storage } from "../../storage"
import { prepareDocumentation, registerGenerateWorker } from "../documents"
import { compareBranchToDefaultBranch } from "../github"
import { enqueueTask, getTaskStatus } from "../task-manager"
import {
  requireOrgMember,
  authorizedHandler,
  AuthorizedOrgRequest,
} from "./authorization"
import { withRepo, RepoRequest, createWorkerErrorHandler } from "./middleware"
import type { DocType, JobType } from "../../shared/schema"

// Helper to create/update repo documentation
async function saveRepoDoc(
  repoPublicId: string,
  branch: string,
  existingDoc: Awaited<ReturnType<typeof storage.getRepoDoc>>,
  docData: {
    title: string
    content: string
    docType: DocType
    generatedFrom: string[]
    model: string
    prompts: Record<string, string>
  }
) {
  const metadata = {
    generatedFrom: docData.generatedFrom,
    aiModel: docData.model,
    timestamp: new Date().toISOString(),
    prompts: docData.prompts,
  }

  if (existingDoc) {
    return storage.updateRepoDoc(existingDoc.id, {
      repoPublicId,
      title: docData.title,
      content: docData.content,
      docType: docData.docType,
      updatedAt: new Date(),
      metadata,
    })
  }

  return storage.createRepoDoc({
    repoPublicId,
    branch,
    title: docData.title,
    content: docData.content,
    docType: docData.docType as DocType,
    metadata,
  })
}

// Common worker completion handler
function createWorkerCompletionHandler(
  repoPublicId: string,
  branch: string,
  jobType: JobType
) {
  return async (id: string) => {
    await storage.updateJob(id, { status: "completed" })
    await storage.removeJobsByBranchAndType(
      repoPublicId,
      branch,
      jobType,
      "error"
    )
  }
}

export function documentsRoutes(app: Express) {
  // Generate documentation - requires membership
  app.post(
    "/api/organization/:org_public_id/repos/:repo_public_id/generate",
    ...requireOrgMember("org_public_id"),
    withRepo(),
    authorizedHandler<RepoRequest>(async (req, res) => {
      const { repoPublicId, branch, orgId } = req

      const repoDoc = await storage.getRepoDoc(repoPublicId, branch, "overview")
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

      registerGenerateWorker(
        "generateDocumentation",
        async ({ content, extra, jobId: id }) => {
          const { prompts } = extra
          await createWorkerCompletionHandler(
            repoPublicId,
            branch,
            "generate"
          )(id)
          await saveRepoDoc(repoPublicId, branch, repoDoc, {
            title: "Repo Documentation",
            content,
            docType: "overview",
            generatedFrom,
            model,
            prompts,
          })
        },
        createWorkerErrorHandler()
      )

      const jobId = await enqueueTask("generateDocumentation", {
        developerPrompt,
        userPrompt,
        model,
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

      const repoDoc = await storage.getRepoDoc(repoPublicId, branch, docType)

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

      registerGenerateWorker(
        "generateDocumentation",
        async ({ content, extra, jobId: id }) => {
          const { prompts } = extra
          await createWorkerCompletionHandler(
            repoPublicId,
            branch,
            "generate"
          )(id)
          await saveRepoDoc(repoPublicId, branch, repoDoc, {
            title: `Delta Documentation: ${branch}`,
            content,
            docType,
            generatedFrom,
            model,
            prompts,
          })
        },
        createWorkerErrorHandler()
      )

      const jobId = await enqueueTask("generateDocumentation", {
        developerPrompt,
        userPrompt,
        model,
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

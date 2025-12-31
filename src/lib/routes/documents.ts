import type { Express } from "express"

import { storage } from "src/storage"
import { prepareDocumentation, registerGenerateWorker } from "../documents"
import { compareBranchToDefaultBranch } from "../github"
import { enqueueTask, getTaskStatus } from "../task-manager"
import {
  asyncHandler,
  withOrganization,
  withRepo,
  RepoRequest,
  OrganizationRequest,
} from "./middleware"
import type { DocType, JobType } from "src/shared/schema"

// Helper to create/update repo documentation
async function saveRepoDoc(
  repoId: string,
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
      repoId,
      title: docData.title,
      content: docData.content,
      docType: docData.docType,
      updatedAt: new Date(),
      metadata,
    })
  }

  return storage.createRepoDoc({
    repoId,
    branch,
    title: docData.title,
    content: docData.content,
    docType: docData.docType as DocType,
    metadata,
  })
}

// Common worker completion handler
function createWorkerCompletionHandler(
  repoId: string,
  branch: string,
  jobType: JobType
) {
  return async (id: string) => {
    await storage.updateJob(id, { status: "completed" })
    await storage.removeJobsByBranchAndType(repoId, branch, jobType, "error")
  }
}

// Common worker error handler
function createWorkerErrorHandler() {
  return async (error: unknown, { id }: { id: string }) => {
    await storage.updateJob(id, {
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    })
  }
}

export function documentsRoutes(app: Express) {
  const orgMiddleware = withOrganization()
  const repoMiddleware = [orgMiddleware, withRepo()]

  // Generate documentation
  app.post(
    "/api/organization/:org_id/repos/:repo_id/generate",
    ...repoMiddleware,
    asyncHandler<RepoRequest>(async (req, res) => {
      const { repoId, branch, orgId } = req

      const repoDoc = await storage.getRepoDoc(repoId, branch, "overview")
      const relevantFiles = await storage.getRepoFiles(repoId, branch)

      if (!relevantFiles.length) {
        res.status(404).json({ error: "No analyzed files found" })
        return
      }

      // Try to get CFG data if it exists
      let cfgContent = ""
      try {
        const cfgDocs = await storage.getRepoDocsByBranch(repoId, branch)
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

      const prd = await storage.getPrdForBranch(repoId, branch)
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
          await createWorkerCompletionHandler(repoId, branch, "generate")(id)
          await saveRepoDoc(repoId, branch, repoDoc, {
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
          repoId,
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

  // Generate change documentation (compare branch)
  app.post(
    "/api/organization/:org_id/repos/:repo_id/compare",
    ...repoMiddleware,
    asyncHandler<RepoRequest>(async (req, res) => {
      const { organization, repo, repoId, branch, orgId } = req
      const docType = "delta"

      const repoDoc = await storage.getRepoDoc(repoId, branch, docType)

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

      const prd = await storage.getPrdForBranch(repoId, branch)
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
          await createWorkerCompletionHandler(repoId, branch, "generate")(id)
          await saveRepoDoc(repoId, branch, repoDoc, {
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
          repoId,
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

  // Get docs for a repo
  app.get(
    "/api/organization/:org_id/repos/:repo_id/docs",
    ...repoMiddleware,
    asyncHandler<RepoRequest>(async (req, res) => {
      const docs = await storage.getRepoDocsByBranch(req.repoId, req.branch)

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

  // Check for any job status
  app.get(
    "/api/organization/:org_id/repos/:repo_id/docs_status",
    ...repoMiddleware,
    asyncHandler<RepoRequest>(async (req, res) => {
      const jobs = await storage.getJobsByBranch(req.repoId, req.branch)
      res.json(jobs)
    }, "Failed to fetch repository documentation status")
  )

  // Check for specific job status
  app.get(
    "/api/organization/:org_id/repos/:repo_id/docs_status/:job_id",
    ...repoMiddleware,
    asyncHandler<RepoRequest>(async (req, res) => {
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

  // Get recent documents for organization
  app.get(
    "/api/organization/:org_id/recent-documents",
    orgMiddleware,
    asyncHandler<OrganizationRequest>(async (req, res) => {
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

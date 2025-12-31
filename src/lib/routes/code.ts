import type { Express } from "express"

import { storage } from "../../storage"
import { getGithubRepo, getLatestCommit, getRepoContent } from "../github"
import { processFileContent } from "../embeddings"
import { vectorStorage } from "../vector-storage"
import { extname } from "path"
import {
  generateCFG,
  visualizeCallGraph,
  visualizeControlFlowGraphs,
} from "../cfg-analyzer"
import { enqueueTask, registerWorker } from "../task-manager"
import {
  asyncHandler,
  withOrganization,
  withRepo,
  RepoRequest,
  OrganizationRequest,
  getRepoById,
} from "./middleware"

// Re-export for backwards compatibility
export { getRepoById }

export function codeRoutes(app: Express) {
  const orgMiddleware = withOrganization()
  const repoMiddleware = [orgMiddleware, withRepo()]

  // Get all repos for an organization
  app.get(
    "/api/organization/:org_id/repos",
    orgMiddleware,
    asyncHandler<OrganizationRequest>(async (req, res) => {
      const repos = await storage.getRepos(req.organization.id)
      res.json(repos)
    }, "Failed to fetch repositories")
  )

  // Get a specific repo
  app.get(
    "/api/organization/:org_id/repos/:repo_id",
    ...repoMiddleware,
    asyncHandler<RepoRequest>(async (req, res) => {
      const ghRepo = await getGithubRepo(req.organization, req.repo)
      const latestCommitDate = await getLatestCommit(
        req.organization,
        req.repo,
        req.branch
      )
      res.json({
        ...req.repo,
        defaultBranch: ghRepo?.default_branch || "",
        latestCommitDate,
      })
    }, "Failed to find repository")
  )

  // Delete a repo
  app.delete(
    "/api/organization/:org_id/repos/:repo_id",
    ...repoMiddleware,
    asyncHandler<RepoRequest>(async (req, res) => {
      await storage.deleteRepo(req.repoId)
      // clear out old storage
      await vectorStorage.deleteByRepoId(req.repoId)
      res.status(204).end()
    }, "Failed to delete repository")
  )

  // Update a repo
  app.patch(
    "/api/organization/:org_id/repos/:repo_id",
    ...repoMiddleware,
    asyncHandler<RepoRequest>(async (req, res) => {
      const { fileFilterRegex } = req.body
      if (!fileFilterRegex) {
        res
          .status(400)
          .json({ error: "Please supply a file regex for matching" })
        return
      }

      await storage.updateRepo(req.repoId, { fileFilterRegex })
      res.status(204).end()
    }, "Failed to update repository")
  )

  // Get embeddings for a repo
  app.get(
    "/api/organization/:org_id/repos/:repo_id/embeddings",
    ...repoMiddleware,
    asyncHandler<RepoRequest>(async (req, res) => {
      const data = await storage.getRepoFiles(req.repoId, req.branch)
      res.json(data)
    }, "Failed to get repository embeddings")
  )

  // Analyze repository files
  app.post(
    "/api/organization/:org_id/repos/:repo_id/analyze",
    ...repoMiddleware,
    asyncHandler<RepoRequest>(async (req, res) => {
      const { organization, repo, repoId, branch, orgId } = req

      const repoContent = await getRepoContent(
        organization,
        repo,
        repo.fileFilterRegex || ".*",
        branch
      )

      // clear out old storage
      await vectorStorage.deleteByRepoId(repoId, branch)
      const repoFiles = await storage.getRepoFiles(repoId, branch)
      for (const repoFile of repoFiles) {
        if (!repoContent.find((f) => f.path === repoFile.filePath)) {
          await storage.deleteRepoFile(repoFile.id)
        }
      }

      // Process each file
      registerWorker(
        "analyzeRepo",
        async (_, job) => {
          for (const file of repoContent) {
            try {
              const extension = extname(file.path).toLowerCase()

              // Process the file content and generate embeddings
              const { chunks, embeddings } = await processFileContent(
                file.content
              )

              // Store each chunk with its embedding in vector storage
              for (let i = 0; i < chunks.length; i++) {
                const vectorId = `${repoId}-${branch}-${file.path}-${i}`
                await vectorStorage.storeEmbedding(vectorId, embeddings[i], {
                  repoId,
                  filePath: file.path,
                  branch,
                  fileId: i,
                  language: extension.slice(1) || "text",
                  lastModified: new Date().toISOString(),
                })
              }

              // Attempt to get existing file, handle if it doesn't exist
              let existingRepoFile
              try {
                existingRepoFile = await storage.getRepoFile(
                  repoId,
                  file.path,
                  branch
                )
              } catch (error: unknown) {
                const errorMessage =
                  error instanceof Error ? error.message : String(error)
                console.log(
                  `File ${file.path} not found in the database, will create it. Error: ${errorMessage}`
                )
              }

              const fileMetadata = {
                size: file.content.length,
                language: extension.slice(1) || "text",
              }

              if (existingRepoFile) {
                await storage.updateRepoFile(existingRepoFile.id, branch, {
                  content: file.content,
                  updatedAt: new Date(),
                  metadata: fileMetadata,
                })
              } else {
                await storage.createRepoFile({
                  repoId,
                  filePath: file.path,
                  content: file.content,
                  branch,
                  metadata: fileMetadata,
                })
              }

              const index = repoContent.findIndex((f) => f.path === file.path)
              console.log(
                "File analyzed:",
                file.path,
                `${index + 1}/${repoContent.length}`
              )
            } catch (fileError) {
              console.error(`Error processing file ${file.path}:`, fileError)
            }
          }
          return { id: job.id }
        },
        async ({ id }) => {
          await storage.updateJob(id, { status: "completed" })
          await storage.removeJobsByBranchAndType(
            repoId,
            branch,
            "analyze",
            "error"
          )
        },
        async (error, { id }) => {
          await storage.updateJob(id, {
            status: "error",
            message: error instanceof Error ? error.message : String(error),
          })
        }
      )

      const jobId = await enqueueTask("analyzeRepo")

      if (jobId) {
        await storage.addJob({
          jobId,
          repoId,
          organizationId: orgId,
          type: "analyze",
          branch,
          status: "pending",
          message: "Job started",
        })
      }

      res.json({ jobId })
    }, "Failed to analyze repository")
  )

  // Generate Call Graph and Control Flow Graph (CFG)
  app.post(
    "/api/organization/:org_id/repos/:repo_id/generate-cfg",
    ...repoMiddleware,
    asyncHandler<RepoRequest>(async (req, res) => {
      const { repoId, branch } = req

      // Get all files in the repository
      const repoFiles = await storage.getRepoFiles(repoId, branch)

      if (!repoFiles.length) {
        res.status(404).json({
          error:
            "No analyzed files found. Please analyze the repository first.",
        })
        return
      }

      // Convert file data to format needed by CFG analyzer
      const fileContents = repoFiles.map((file) => ({
        path: file.filePath,
        content: file.content || "",
      }))

      // Generate Call Graph and Control Flow Graph
      const cfgResult = await generateCFG(fileContents)

      // Create visualization texts
      const callGraphText = visualizeCallGraph(cfgResult.callGraph)
      const cfgText = visualizeControlFlowGraphs(cfgResult.controlFlowGraphs)

      // Combine for content
      const combinedContent = `# Repository Analysis: Call Graph and Control Flow Graph\n\n${callGraphText}\n\n${cfgText}`

      // Check for existing CFG doc
      const existingDocs = await storage.getRepoDocsByBranch(repoId, branch)
      const cfgDoc = existingDocs.find((doc) => doc.docType === "cfg")

      const docMetadata = {
        generatedFrom: repoFiles.map((f) => f.filePath),
        aiModel: "static-analysis",
        timestamp: new Date().toISOString(),
        prompts: {},
      }

      // Store the generated CFG
      const doc = cfgDoc
        ? await storage.updateRepoDoc(cfgDoc.id, {
            repoId,
            branch,
            title: "Code Structure Analysis",
            content: combinedContent,
            docType: "cfg",
            updatedAt: new Date(),
            metadata: docMetadata,
          })
        : await storage.createRepoDoc({
            repoId,
            branch,
            title: "Code Structure Analysis",
            content: combinedContent,
            docType: "cfg",
            metadata: docMetadata,
          })

      res.json({
        success: true,
        message: "Call Graph and Control Flow Graph generated successfully",
        doc,
      })
    }, "Failed to generate Call Graph and Control Flow Graph")
  )

  // Retrieve CFG data
  app.get(
    "/api/organization/:org_id/repos/:repo_id/cfg",
    ...repoMiddleware,
    asyncHandler<RepoRequest>(async (req, res) => {
      const docs = await storage.getRepoDocsByBranch(req.repoId, req.branch)

      // Find the most recent CFG document
      const cfgDocs = docs
        .filter((doc) => doc.docType === "cfg")
        .sort(
          (a, b) =>
            new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        )

      if (cfgDocs.length === 0) {
        res.status(404).json({
          error: "No CFG analysis found for this repository",
          message: "Please generate CFG analysis first",
        })
        return
      }

      res.json(cfgDocs[0])
    }, "Failed to fetch CFG data")
  )
}

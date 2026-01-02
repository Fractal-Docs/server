import type { Express } from "express"

import { storage } from "../../storage"
import {
  getGithubRepo,
  getLatestCommit,
  getRepoContent,
  CommitDetails,
} from "../github"
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
  requireOrgMember,
  requireOrgAdmin,
  authorizedHandler,
  AuthorizedOrgRequest,
} from "./authorization"
import { withRepo, RepoRequest, getRepoByPublicId } from "./middleware"

// Re-export for backwards compatibility
export { getRepoByPublicId }

export function codeRoutes(app: Express) {
  // Get all repos for an organization - requires membership
  app.get(
    "/api/organization/:org_public_id/repos",
    ...requireOrgMember("org_public_id"),
    authorizedHandler<AuthorizedOrgRequest>(async (req, res) => {
      const repos = await storage.getRepos(req.organization.publicId)

      // Return repos with publicId, not internal id
      const sanitizedRepos = repos.map((repo) => ({
        publicId: repo.publicId,
        name: repo.name,
        fullName: repo.fullName,
        owner: repo.owner,
        fileFilterRegex: repo.fileFilterRegex,
        createdAt: repo.createdAt,
      }))

      res.json(sanitizedRepos)
    }, "Failed to fetch repositories")
  )

  // Get a specific repo - requires membership
  app.get(
    "/api/organization/:org_public_id/repos/:repo_public_id",
    ...requireOrgMember("org_public_id"),
    withRepo(),
    authorizedHandler<RepoRequest>(async (req, res) => {
      const ghRepo = await getGithubRepo(req.organization, req.repo)
      let latestCommit: CommitDetails | null = null
      try {
        latestCommit = await getLatestCommit(
          req.organization,
          req.repo,
          req.branch
        )
      } catch {
        // Branch may have been deleted, clean up related data
        const repoFiles = await storage.getRepoFiles(
          req.repoPublicId,
          req.branch
        )
        await Promise.all(
          repoFiles.map((repoFile) => storage.deleteRepoFile(repoFile.id))
        )
        const repoDocs = await storage.getRepoDocsByBranch(
          req.repoPublicId,
          req.branch
        )
        await Promise.all(
          repoDocs.map((repoDoc) => storage.deleteRepoDoc(repoDoc.id))
        )
        await vectorStorage.deleteByRepoId(req.repoPublicId, req.branch)
      }

      // Return repo with publicId
      res.json({
        publicId: req.repo.publicId,
        name: req.repo.name,
        fullName: req.repo.fullName,
        owner: req.repo.owner,
        fileFilterRegex: req.repo.fileFilterRegex,
        createdAt: req.repo.createdAt,
        defaultBranch: ghRepo?.default_branch || "",
        latestCommit,
      })
    }, "Failed to find repository")
  )

  // Delete a repo - requires admin role
  app.delete(
    "/api/organization/:org_public_id/repos/:repo_public_id",
    ...requireOrgAdmin("org_public_id"),
    withRepo(),
    authorizedHandler<RepoRequest>(async (req, res) => {
      await storage.deleteRepoByPublicId(req.repoPublicId)
      // clear out old storage
      await vectorStorage.deleteByRepoId(req.repoPublicId)
      res.status(204).end()
    }, "Failed to delete repository")
  )

  // Update a repo - requires admin role
  app.patch(
    "/api/organization/:org_public_id/repos/:repo_public_id",
    ...requireOrgAdmin("org_public_id"),
    withRepo(),
    authorizedHandler<RepoRequest>(async (req, res) => {
      const { fileFilterRegex } = req.body
      if (!fileFilterRegex) {
        res
          .status(400)
          .json({ error: "Please supply a file regex for matching" })
        return
      }

      await storage.updateRepoByPublicId(req.repoPublicId, { fileFilterRegex })
      res.status(204).end()
    }, "Failed to update repository")
  )

  // Get embeddings for a repo - requires membership
  app.get(
    "/api/organization/:org_public_id/repos/:repo_public_id/embeddings",
    ...requireOrgMember("org_public_id"),
    withRepo(),
    authorizedHandler<RepoRequest>(async (req, res) => {
      const data = await storage.getRepoFiles(req.repoPublicId, req.branch)
      res.json(data)
    }, "Failed to get repository embeddings")
  )

  // Analyze repository files - requires membership
  app.post(
    "/api/organization/:org_public_id/repos/:repo_public_id/analyze",
    ...requireOrgMember("org_public_id"),
    withRepo(),
    authorizedHandler<RepoRequest>(async (req, res) => {
      const { organization, repo, repoPublicId, branch, orgId } = req

      const repoContent = await getRepoContent(
        organization,
        repo,
        repo.fileFilterRegex || ".*",
        branch
      )

      // clear out old storage
      await vectorStorage.deleteByRepoId(repoPublicId, branch)
      const repoFiles = await storage.getRepoFiles(repoPublicId, branch)
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
                const vectorId = `${repoPublicId}-${branch}-${file.path}-${i}`
                await vectorStorage.storeEmbedding(vectorId, embeddings[i], {
                  repoId: repoPublicId,
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
                  repoPublicId,
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
                  repoPublicId,
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
            repoPublicId,
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
          repoPublicId,
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

  // Generate Call Graph and Control Flow Graph (CFG) - requires membership
  app.post(
    "/api/organization/:org_public_id/repos/:repo_public_id/generate-cfg",
    ...requireOrgMember("org_public_id"),
    withRepo(),
    authorizedHandler<RepoRequest>(async (req, res) => {
      const { repoPublicId, branch } = req

      // Get all files in the repository
      const repoFiles = await storage.getRepoFiles(repoPublicId, branch)

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
      const existingDocs = await storage.getRepoDocsByBranch(
        repoPublicId,
        branch
      )
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
            repoPublicId,
            branch,
            title: "Code Structure Analysis",
            content: combinedContent,
            docType: "cfg",
            updatedAt: new Date(),
            metadata: docMetadata,
          })
        : await storage.createRepoDoc({
            repoPublicId,
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

  // Retrieve CFG data - requires membership
  app.get(
    "/api/organization/:org_public_id/repos/:repo_public_id/cfg",
    ...requireOrgMember("org_public_id"),
    withRepo(),
    authorizedHandler<RepoRequest>(async (req, res) => {
      const docs = await storage.getRepoDocsByBranch(
        req.repoPublicId,
        req.branch
      )

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

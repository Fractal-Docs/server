import type { Express } from "express"

import { storage } from "src/storage"
import { getParams } from "../helpers"
import { prepareDocumentation, registerGenerateWorker } from "../documents"
import { compareBranchToDefaultBranch } from "../github"
import { enqueueTask, getTaskStatus } from "../task-manager"

async function getRepoById(id: string, res) {
  const data = await storage.getRepo(id)
  if (!data) {
    res.status(404).json({ error: "No repository found" })
    return
  }

  return data
}

export function documentsRoutes(app: Express) {
  // Endpoint to generate documentation
  app.post(
    "/api/organization/:org_id/repos/:repo_id/generate",
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

        const repoDoc = await storage.getRepoDoc(repo_id, branch, "overview")
        const relevantFiles = await storage.getRepoFiles(repo_id, branch)

        if (!relevantFiles.length) {
          res.status(404).json({ error: "No analyzed files found" })
          return
        }

        // Try to get CFG data if it exists
        let cfgContent = ""
        try {
          const cfgDocs = await storage.getRepoDocsByBranch(repo_id, branch)
          const cfgDoc = cfgDocs.find((doc) => doc.docType === "cfg")
          if (cfgDoc) {
            cfgContent = cfgDoc.content
          }
        } catch (error: any) {
          console.log(
            `No CFG data found, proceeding without it. Error: ${error.message}`
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

        const prd = await storage.getPrdForBranch(repo_id, branch)
        const businessContext = prd
          ? `PRD Business Context: ${prd?.businessContext}\n\n PRD Content: ${prd?.content}`
          : ""

        const { developerPrompt, userPrompt, model } =
          await prepareDocumentation(codeWithCfg, businessContext)

        registerGenerateWorker(
          "generateDocumentation",
          async ({ content, extra, jobId: id }) => {
            const { prompts } = extra
            await storage.updateJob(id, {
              status: "completed",
            })
            await storage.removeJobsByBranchAndType(
              repo_id,
              branch,
              "generate",
              "error"
            )
            // Store the generated documentation with actual prompts in metadata
            if (repoDoc) {
              await storage.updateRepoDoc(repoDoc.id, {
                repoId: repo_id,
                title: `Repo Documentation`,
                content,
                docType: "overview",
                updatedAt: new Date(),
                metadata: {
                  generatedFrom: relevantFiles.map((f) => f!.filePath),
                  aiModel: model,
                  timestamp: new Date().toISOString(),
                  prompts,
                },
              })
              return
            }
            await storage.createRepoDoc({
              repoId: repo_id,
              branch,
              title: `Repo Documentation`,
              content,
              docType: "overview",
              metadata: {
                generatedFrom: relevantFiles.map((f) => f!.filePath),
                aiModel: model,
                timestamp: new Date().toISOString(),
                prompts,
              },
            })
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

        if (jobId) {
          await storage.addJob({
            jobId,
            repoId: repo_id,
            organizationId: org_id,
            type: "generate",
            branch,
            status: "pending",
            message: "Job started",
          })
        }

        res.json({ jobId })
      } catch (error: unknown) {
        const message =
          error instanceof Error
            ? error.message
            : "Failed to generate documentation"
        res.status(500).json({ error: message })
      }
    }
  )

  // Endpoint to generate change documentation
  app.post(
    "/api/organization/:org_id/repos/:repo_id/compare",
    async (req, res) => {
      try {
        const docType = "delta"
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

        const repoDoc = await storage.getRepoDoc(repo_id, branch, docType)

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

        const prd = await storage.getPrdForBranch(repo_id, branch)
        const businessContext = prd
          ? `PRD Business Context: ${prd?.businessContext}\n\n PRD Content: ${prd?.content}`
          : ""

        const { developerPrompt, userPrompt, model } =
          await prepareDocumentation(fileContents, businessContext)

        registerGenerateWorker(
          "generateDocumentation",
          async ({ content, extra, jobId: id }) => {
            const { prompts } = extra
            // update the job to completed and clean up the old error jobs
            await storage.updateJob(id, { status: "completed" })
            await storage.removeJobsByBranchAndType(
              repo_id,
              branch,
              "generate",
              "error"
            )
            // Store the generated documentation with actual prompts in metadata
            if (repoDoc) {
              await storage.updateRepoDoc(repoDoc.id, {
                repoId: repo_id,
                title: `Delta Documentation: ${branch}`,
                content,
                docType,
                updatedAt: new Date(),
                metadata: {
                  generatedFrom: relevantFiles.map((f) => f!.filename),
                  aiModel: model,
                  timestamp: new Date().toISOString(),
                  prompts,
                },
              })
              return
            }
            await storage.createRepoDoc({
              repoId: repo_id,
              branch,
              title: `Delta Documentation: ${branch}`,
              content,
              docType: "delta",
              metadata: {
                generatedFrom: relevantFiles.map((f) => f!.filename),
                aiModel: model,
                timestamp: new Date().toISOString(),
                prompts,
              },
            })
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

        if (jobId) {
          await storage.addJob({
            jobId,
            repoId: repo_id,
            organizationId: org_id,
            type: "generate",
            branch,
            status: "pending",
            message: "Job started",
          })
        }

        res.json({ jobId })
      } catch (error: unknown) {
        const message =
          error instanceof Error
            ? error.message
            : "Failed to list repository files"
        res.status(500).json({ error: message })
      }
    }
  )

  app.get("/api/organization/:org_id/repos/:repo_id/docs", async (req, res) => {
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
      const docs = await storage.getRepoDocsByBranch(repo_id, branch)

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
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to fetch repository documentation"
      res.status(500).json({ error: message })
    }
  })

  // Check for any job
  app.get(
    "/api/organization/:org_id/repos/:repo_id/docs_status",
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
        const jobs = await storage.getJobsByBranch(repo_id, branch)

        res.json(jobs)
      } catch (error: unknown) {
        const message =
          error instanceof Error
            ? error.message
            : "Failed to fetch repository documentation"
        res.status(500).json({ error: message })
      }
    }
  )

  // Check for specific job
  app.get(
    "/api/organization/:org_id/repos/:repo_id/docs_status/:job_id",
    async (req, res) => {
      try {
        const status = await getTaskStatus(
          "generateDocumentation",
          req.params.job_id
        )
        if (!status) {
          res.status(404).json({ error: "Not found" })
          return
        }
        res.json(status)
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : "Failed to get task status"
        res.status(500).json({ error: message })
      }
    }
  )

  app.get("/api/organization/:org_id/recent-documents", async (req, res) => {
    try {
      const { org_id } = getParams(req, res, ["org_id"])
      const organization = await storage.getOrganization(org_id)
      if (!organization) {
        res.status(404).json({ error: "Organization not found" })
        return
      }

      const docs = await storage.getOrganizationDocs(org_id)
      const recentDocs = docs
        .filter((doc) => doc.docType !== "cfg")
        .sort(
          (a, b) =>
            new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
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
}

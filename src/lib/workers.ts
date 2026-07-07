import { extname } from "path"
import { storage } from "../storage"
import { getRepoContent } from "./github"
import { processFileContent } from "./embeddings"
import { vectorStorage } from "./vector-storage"
import { registerWorker } from "./task-manager"
import { registerGenerateWorker } from "./documents"
import { createWorkerErrorHandler } from "./routes/middleware"
import type { DocType, RoleRecord } from "../shared/schema"
import { generateRoleDocuments } from "./routes/releases"

export interface AnalyzeRepoJobData {
  repoPublicId: string
  branch: string
  orgId: string
}

type AnalyzeRepoJobResult = { id: string } & AnalyzeRepoJobData

function registerAnalyzeRepoWorker() {
  registerWorker<AnalyzeRepoJobData, AnalyzeRepoJobResult>(
    "analyzeRepo",
    async ({ repoPublicId, branch, orgId }, job) => {
      const organization = await storage.getOrganizationByPublicId(orgId)
      const repo = await storage.getRepoByPublicId(repoPublicId)
      if (!organization || !repo) {
        throw new Error(
          `Cannot analyze: organization or repo not found (org=${orgId}, repo=${repoPublicId})`
        )
      }

      const repoContent = await getRepoContent(
        organization,
        repo,
        repo.fileFilterRegex || ".*",
        branch
      )

      // Clear out storage for files no longer present in the repo
      await vectorStorage.deleteByRepoId(repoPublicId, branch)
      const existingRepoFiles = await storage.getRepoFiles(repoPublicId, branch)
      for (const repoFile of existingRepoFiles) {
        if (!repoContent.find((f) => f.path === repoFile.filePath)) {
          await storage.deleteRepoFile(repoFile.id)
        }
      }

      for (const file of repoContent) {
        try {
          const extension = extname(file.path).toLowerCase()

          const { chunks, embeddings } = await processFileContent(file.content)

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

      return { id: job.id!, repoPublicId, branch, orgId }
    },
    async ({ id, repoPublicId, branch }: AnalyzeRepoJobResult) => {
      await storage.updateJob(id, { status: "completed" })
      await storage.removeJobsByBranchAndType(
        repoPublicId,
        branch,
        "analyze",
        "error"
      )
    },
    createWorkerErrorHandler()
  )
}

export interface GenerateDocumentationExtra {
  repoPublicId: string
  branch: string
  docType: DocType
  title: string
  generatedFrom: string[]
}

function registerDocumentGenerationWorker() {
  registerGenerateWorker(
    "generateDocumentation",
    async ({ content, extra, jobId: id }) => {
      const { repoPublicId, branch, docType, title, generatedFrom, prompts } =
        extra as GenerateDocumentationExtra & {
          prompts: Record<string, string>
        }

      await storage.updateJob(id, { status: "completed" })
      await storage.removeJobsByBranchAndType(
        repoPublicId,
        branch,
        "generate",
        "error"
      )

      const existingDoc = await storage.getRepoDoc(
        repoPublicId,
        branch,
        docType
      )
      const metadata = {
        generatedFrom,
        aiModel: extra.model,
        timestamp: new Date().toISOString(),
        prompts,
      }

      if (existingDoc) {
        await storage.updateRepoDoc(existingDoc.id, {
          repoPublicId,
          title,
          content,
          docType,
          updatedAt: new Date(),
          metadata,
        })
      } else {
        await storage.createRepoDoc({
          repoPublicId,
          branch,
          title,
          content,
          docType,
          metadata,
        })
      }
    },
    createWorkerErrorHandler()
  )
}

export interface GenerateReleaseExtra {
  repoPublicId: string
  branch: string
  orgId: string
  title: string
  roles: string[]
}

function registerReleaseGenerationWorker() {
  registerGenerateWorker(
    "generateReleaseDocumentation",
    async ({ content, extra, jobId: id }) => {
      const { repoPublicId, branch, orgId, title, roles } =
        extra as GenerateReleaseExtra

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
        details: { releasePublicId: release.publicId },
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
}

export interface GenerateRoleExtra {
  repoPublicId: string
  branch: string
  releasePublicId: string
  role: RoleRecord
}

function registerRoleGenerationWorker() {
  registerGenerateWorker(
    "generateRoleDocumentation",
    async ({ content, extra, jobId: id }) => {
      const { repoPublicId, branch, releasePublicId, role } =
        extra as GenerateRoleExtra

      console.log(
        `Generated role documentation for role ${role?.roleType}, releasePublicId ${releasePublicId}`
      )
      await storage.updateJob(id, {
        status: "completed",
        details: { releasePublicId, rolePublicId: role.publicId },
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

// Registers every background-job worker exactly once, at process boot.
// Must run before any route can enqueue a job.
export function registerBackgroundWorkers() {
  registerAnalyzeRepoWorker()
  registerDocumentGenerationWorker()
  registerReleaseGenerationWorker()
  registerRoleGenerationWorker()
}

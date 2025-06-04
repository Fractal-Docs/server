import type { Express } from "express";

import { storage } from "../../storage";
import {
  compareBranchToDefaultBranch,
  getGithubRepo,
  getLatestCommit,
  getRepoContent,
} from "../github";
import { generateDocumentation } from "../openai";
import { processFileContent, generateEmbedding } from "../embeddings";
import { vectorStorage } from "../vector-storage";
import { extname } from "path";
import {
  generateCFG,
  visualizeCallGraph,
  visualizeControlFlowGraphs,
} from "../cfg-analyzer";
import { getParams } from "../helpers";

async function getRepoById(id: string, res) {
  const data = await storage.getRepo(id);
  if (!data) {
    res.status(404).json({ error: "No repository found" });
    return;
  }

  return data;
}

export function codeRoutes(app: Express) {
  app.get("/api/repos", async (req, res) => {
    try {
      const userSub = req.headers["user-sub"] as string;
      if (!userSub) {
        res.status(401).json({ error: "User sub not provided" });
        return;
      }
      const user = await storage.getUser(userSub);
      if (!user || !user.accessToken) {
        res.status(401).json({ error: "GitHub not authenticated" });
        return;
      }
      const repos = await storage.getRepos(user.repos);
      res.json(repos);
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to fetch repositories";
      res.status(500).json({ error: message });
    }
  });

  app.get("/api/repos/:id", async (req, res) => {
    try {
      const { id, branch } = getParams(req, res);
      const repo = await getRepoById(id, res);
      const userSub = req.headers["user-sub"] as string;
      if (!userSub) {
        res.status(401).json({ error: "User sub not provided" });
        return;
      }
      const user = await storage.getUser(userSub);
      if (!user || !user.accessToken) {
        res.status(401).json({ error: "GitHub not authenticated" });
        return;
      }
      if (!repo) return;

      const ghRepo = await getGithubRepo(
        user.accessToken,
        `https://github.com/${repo.fullName}`
      );
      const latestCommitDate = await getLatestCommit(
        user.accessToken,
        `https://github.com/${repo.fullName}`,
        branch
      );
      res.json({
        ...repo,
        defaultBranch: ghRepo.default_branch,
        latestCommitDate,
      });
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to find repository";
      res.status(500).json({ error: message });
    }
  });

  app.delete("/api/repos/:id", async (req, res) => {
    try {
      const { id } = getParams(req, res);

      await storage.deleteRepo(id.toString());
      // clear out old storage
      await vectorStorage.deleteByRepoId(id);
      res.status(204).end();
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to delete repository";
      res.status(500).json({ error: message });
    }
  });

  app.patch("/api/repos/:id", async (req, res) => {
    try {
      const { id } = getParams(req, res);
      const { fileFilterRegex } = req.body;
      if (!fileFilterRegex) {
        res
          .status(400)
          .json({ error: "Please supply a file regex for matching" });
      }

      await storage.updateRepo(id, { fileFilterRegex });
      res.status(204).end();
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to update repository";
      res.status(500).json({ error: message });
    }
  });

  app.get("/api/repos/:id/embeddings", async (req, res) => {
    try {
      const { id, branch } = getParams(req, res);

      const data = await storage.getRepoFiles(id, branch);
      res.json(data);
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to get repository embeddings";
      res.status(500).json({ error: message });
    }
  });

  // Endpoint to analyze repository files
  app.post("/api/repos/:id/analyze", async (req, res) => {
    try {
      const { id, branch } = getParams(req, res);
      const repo = await getRepoById(id, res);
      if (!repo) {
        res.status(404).json({ error: "Repository not found" });
        return;
      }

      const repoContent = await getRepoContent(
        repo.accessToken,
        `https://github.com/${repo.fullName}`,
        repo.fileFilterRegex || ".*",
        branch || "main"
      );

      // clear out old storage
      await vectorStorage.deleteByRepoId(id, branch);
      const repoFiles = await storage.getRepoFiles(id, branch);
      for (const repoFile of repoFiles) {
        if (!repoContent.find((f) => f.path === repoFile.filePath)) {
          await storage.deleteRepoFile(repoFile.id);
        }
      }

      // Process each file
      for (const file of repoContent) {
        try {
          const extension = extname(file.path).toLowerCase();

          // Process the file content and generate embeddings
          const { chunks, embeddings } = await processFileContent(file.content);

          // Store each chunk with its embedding in vector storage
          for (let i = 0; i < chunks.length; i++) {
            const vectorId = `${id}-${branch}-${file.path}-${i}`;
            await vectorStorage.storeEmbedding(vectorId, embeddings[i], {
              repoId: id,
              filePath: file.path,
              branch,
              fileId: i,
              language: extension.slice(1) || "text",
              lastModified: new Date().toISOString(),
            });
          }

          // Attempt to get existing file, handle if it doesn't exist
          let repoFile;
          try {
            repoFile = await storage.getRepoFile(id, file.path, branch);
          } catch (error: any) {
            console.log(
              `File ${file.path} not found in the database, will create it. Error: ${error.message}`
            );
          }

          if (repoFile) {
            // Update the file in database
            await storage.updateRepoFile(repoFile.id, branch, {
              content: file.content,
              updatedAt: new Date(),
              metadata: {
                size: file.content.length,
                language: extension.slice(1) || "text",
              },
            });
          } else {
            await storage.createRepoFile({
              repoId: id,
              filePath: file.path,
              content: file.content,
              branch,
              metadata: {
                size: file.content.length,
                language: extension.slice(1) || "text",
              },
            });
          }

          const index = repoContent.findIndex((f) => f.path === file.path);
          console.log(
            "File analyzed:",
            file.path,
            `${index + 1}/${repoContent.length}`
          );
        } catch (fileError) {
          console.error(`Error processing file ${file.path}:`, fileError);
        }
      }

      res.json({ success: true, message: "Repository analysis completed" });
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to analyze repository";
      res.status(500).json({ error: message });
    }
  });

  // Endpoint to generate documentation
  app.post("/api/repos/:id/generate-docs", async (req, res) => {
    try {
      const { id, branch } = getParams(req, res);
      const { docType, query, model = "gpt-4o" } = req.body;

      const repoDoc = await storage.getRepoDoc(id, branch, docType);

      // If a specific query is provided, use vector search to find relevant files
      let relevantFiles;
      if (query) {
        const queryEmbedding = await generateEmbedding(query);
        const similarResults = await vectorStorage.searchSimilar(
          queryEmbedding,
          id,
          10
        );
        relevantFiles = await Promise.all(
          similarResults.map(async (result) => {
            const file = await storage.getRepoFile(
              id,
              result.metadata.filePath,
              branch
            );
            return file;
          })
        );
      } else {
        // Otherwise use all files
        relevantFiles = await storage.getRepoFiles(id, branch);
      }

      if (!relevantFiles.length) {
        res.status(404).json({ error: "No analyzed files found" });
        return;
      }

      console.log("Relevant files found:", relevantFiles.length);

      // Try to get CFG data if it exists
      let cfgContent = "";
      try {
        const cfgDocs = await storage.getRepoDocs(id, branch);
        const cfgDoc = cfgDocs.find((doc) => doc.docType === "cfg");
        if (cfgDoc) {
          console.log("CFG data found, including in documentation generation");
          cfgContent = cfgDoc.content;
        }
      } catch (error: any) {
        console.log(
          `No CFG data found, proceeding without it. Error: ${error.message}`
        );
      }

      // Generate documentation using OpenAI
      const fileContents = relevantFiles
        .filter((file) => file !== undefined)
        .map(
          (file) =>
            `File: ${file!.filePath}\n\n${JSON.stringify(file!.metadata, null, 2)}\n\nContent:\n${file!.content || "No content available"}`
        )
        .join("\n\n");

      console.log("File contents extracted");

      // If we have CFG data, include it with file contents
      const codeWithCfg = cfgContent
        ? `${fileContents}\n\n${cfgContent}`
        : fileContents;

      const prd = await storage.getPrdForBranch(id, branch);
      const businessContext = prd
        ? `PRD Business Context: ${prd?.businessContext}\n\n PRD Content: ${prd?.content}`
        : "";

      const { content: documentation, prompts } = await generateDocumentation(
        codeWithCfg,
        businessContext,
        model as "gpt-4o" | "gpt-3.5-turbo" | "o1-mini"
      );

      console.log("Documentation generated");

      // Store the generated documentation with actual prompts in metadata
      const doc = repoDoc
        ? await storage.updateRepoDoc(repoDoc.id, {
            repoId: id,
            title: `${docType} Documentation`,
            content: documentation,
            docType,
            updatedAt: new Date(),
            metadata: {
              generatedFrom: relevantFiles.map((f) => f!.filePath),
              aiModel: model,
              timestamp: new Date().toISOString(),
              prompts,
            },
          })
        : await storage.createRepoDoc({
            repoId: id,
            branch,
            title: `${docType} Documentation`,
            content: documentation,
            docType,
            metadata: {
              generatedFrom: relevantFiles.map((f) => f!.filePath),
              aiModel: model,
              timestamp: new Date().toISOString(),
              prompts,
            },
          });

      console.log("Repo doc created");

      res.json(doc);
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to generate documentation";
      res.status(500).json({ error: message });
    }
  });

  // Add new route to get previously generated documentation
  app.get("/api/repos/:id/docs", async (req, res) => {
    try {
      const { id, branch } = getParams(req, res);
      const docs = await storage.getRepoDocs(id, branch);

      // Sort by updatedAt to get the most recent doc
      const sortedDocs = docs.sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      );

      if (!sortedDocs.length) {
        res.status(404).json({
          error: "No documentation found for this repository",
        });
        return;
      }

      res.json(sortedDocs);
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to fetch repository documentation";
      res.status(500).json({ error: message });
    }
  });

  // Endpoint to generate Call Graph and Control Flow Graph (CFG)
  app.post("/api/repos/:id/generate-cfg", async (req, res) => {
    try {
      const { id, branch } = getParams(req, res);
      const repo = await getRepoById(id, res);
      if (!repo) return;

      // Get all files in the repository
      const repoFiles = await storage.getRepoFiles(id, branch);

      if (!repoFiles.length) {
        res.status(404).json({
          error:
            "No analyzed files found. Please analyze the repository first.",
        });
        return;
      }

      // Convert file data to format needed by CFG analyzer
      const fileContents = repoFiles.map((file) => ({
        path: file.filePath,
        content: file.content || "",
      }));

      console.log("Generating CFG for", fileContents.length, "files");

      // Generate Call Graph and Control Flow Graph
      const cfgResult = await generateCFG(fileContents);

      // Create visualization texts
      const callGraphText = visualizeCallGraph(cfgResult.callGraph);
      const cfgText = visualizeControlFlowGraphs(cfgResult.controlFlowGraphs);

      // Combine for content
      const combinedContent = `# Repository Analysis: Call Graph and Control Flow Graph\n\n${callGraphText}\n\n${cfgText}`;

      // Check for existing CFG doc
      const existingDocs = await storage.getRepoDocs(id, branch);
      const cfgDoc = existingDocs.find((doc) => doc.docType === "cfg");

      // Store the generated CFG
      const doc = cfgDoc
        ? await storage.updateRepoDoc(cfgDoc.id, {
            repoId: id,
            branch,
            title: "Code Structure Analysis",
            content: combinedContent,
            docType: "cfg",
            updatedAt: new Date(),
            metadata: {
              generatedFrom: repoFiles.map((f) => f.filePath),
              aiModel: "static-analysis",
              timestamp: new Date().toISOString(),
              prompts: {},
            },
          })
        : await storage.createRepoDoc({
            repoId: id,
            branch,
            title: "Code Structure Analysis",
            content: combinedContent,
            docType: "cfg",
            metadata: {
              generatedFrom: repoFiles.map((f) => f.filePath),
              aiModel: "static-analysis",
              timestamp: new Date().toISOString(),
              prompts: {},
            },
          });

      console.log("CFG generated and stored");

      res.json({
        success: true,
        message: "Call Graph and Control Flow Graph generated successfully",
        doc,
      });
    } catch (error: unknown) {
      console.error("Error generating CFG:", error);
      const message =
        error instanceof Error
          ? error.message
          : "Failed to generate Call Graph and Control Flow Graph";
      res.status(500).json({ error: message });
    }
  });

  // Endpoint to retrieve CFG data
  app.get("/api/repos/:id/cfg", async (req, res) => {
    try {
      const { id, branch } = getParams(req, res);
      const docs = await storage.getRepoDocs(id, branch);

      // Find the most recent CFG document
      const cfgDocs = docs
        .filter((doc) => doc.docType === "cfg")
        .sort(
          (a, b) =>
            new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        );

      if (cfgDocs.length === 0) {
        res.status(404).json({
          error: "No CFG analysis found for this repository",
          message: "Please generate CFG analysis first",
        });
        return;
      }

      res.json(cfgDocs[0]);
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to fetch CFG data";
      res.status(500).json({ error: message });
    }
  });

  app.post("/api/repos/:id/compare", async (req, res) => {
    try {
      const { id, branch } = getParams(req, res);
      const { docType, model = "gpt-4o" } = req.body;
      const userSub = req.headers["user-sub"] as string;
      if (!userSub) {
        res.status(401).json({ error: "User sub not provided" });
        return;
      }
      const user = await storage.getUser(userSub);
      if (!user || !user.accessToken) {
        res.status(401).json({ error: "GitHub not authenticated" });
        return;
      }

      const repo = await storage.getRepo(id);

      if (!repo) {
        res.status(404).json({ error: "Repository not found" });
        return;
      }
      const repoDoc = await storage.getRepoDoc(id, branch, "change");

      const response = await compareBranchToDefaultBranch(
        user.accessToken,
        `https://github.com/${repo.fullName}`,
        branch
      );

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
        ) || [];

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
        .join("\n\n");

      const prd = await storage.getPrdForBranch(id, branch);
      const businessContext = prd
        ? `PRD Business Context: ${prd?.businessContext}\n\n PRD Content: ${prd?.content}`
        : "";

      const { content: documentation, prompts } = await generateDocumentation(
        fileContents,
        businessContext,
        model as "gpt-4o" | "gpt-3.5-turbo" | "o1-mini",
        "change"
      );

      console.log("Documentation generated");

      // Store the generated documentation with actual prompts in metadata
      const doc = repoDoc
        ? await storage.updateRepoDoc(repoDoc.id, {
            repoId: id,
            title: `${docType} Documentation`,
            content: documentation,
            docType,
            updatedAt: new Date(),
            metadata: {
              generatedFrom: relevantFiles.map((f) => f!.filename),
              aiModel: model,
              timestamp: new Date().toISOString(),
              prompts,
            },
          })
        : await storage.createRepoDoc({
            repoId: id,
            branch,
            title: `${docType} Documentation`,
            content: documentation,
            docType,
            metadata: {
              generatedFrom: relevantFiles.map((f) => f!.filename),
              aiModel: model,
              timestamp: new Date().toISOString(),
              prompts,
            },
          });

      console.log("Documentation stored");

      res.json({
        success: true,
        message: "Change documentation generated successfully",
        doc,
      });
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to list repository files";
      res.status(500).json({ error: message });
    }
  });
}

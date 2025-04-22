import type { Express } from "express";

import { storage } from "../../storage";
import { getRepoContent } from "../github";
import { generateDocumentation } from "../openai";
import { processFileContent, generateEmbedding } from "../embeddings";
import { vectorStorage } from "../vector-storage";
import { extname } from "path";
import {
  generateCFG,
  visualizeCallGraph,
  visualizeControlFlowGraphs,
} from "../cfg-analyzer";

function getIdFromParams(req, res) {
  const { id } = req.params;
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid repository ID" });
    return;
  }

  return id;
}

async function getRepoById(id: string, res) {
  const data = await storage.getRepo(id);
  if (!data) {
    res.status(404).json({ error: "No repository found" });
    return;
  }

  return data;
}

export function codeRoutes(app: Express) {
  app.get("/api/repos", async (_req, res) => {
    try {
      const repos = await storage.getRepos();
      res.json(repos);
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to fetch repositories";
      res.status(500).json({ error: message });
    }
  });

  app.get("/api/repos/:id", async (req, res) => {
    try {
      const id = getIdFromParams(req, res);
      const repo = await getRepoById(id, res);
      if (!repo) return;
      res.json(repo);
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to find repository";
      res.status(500).json({ error: message });
    }
  });

  app.delete("/api/repos/:id", async (req, res) => {
    try {
      const id = getIdFromParams(req, res);
      await storage.deleteRepo(id.toString());
      res.status(204).end();
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to delete repository";
      res.status(500).json({ error: message });
    }
  });

  app.patch("/api/repos/:id", async (req, res) => {
    try {
      const id = getIdFromParams(req, res);
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
      const id = getIdFromParams(req, res);

      const data = await storage.getRepoFiles(id);
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
      const id = getIdFromParams(req, res);
      const { fileFilterRegex } = req.body;
      const repo = await getRepoById(id, res);
      if (!repo) return;

      if (!fileFilterRegex) {
        res
          .status(400)
          .json({ error: "Please supply a file regex for matching" });
      }

      const repoContent = await getRepoContent(
        repo.accessToken,
        `https://github.com/${repo.fullName}`,
        fileFilterRegex
      );

      // Process each file
      for (const file of repoContent) {
        try {
          const extension = extname(file.path).toLowerCase();

          // Process the file content and generate embeddings
          const { chunks, embeddings } = await processFileContent(file.content);

          // Store each chunk with its embedding in vector storage
          for (let i = 0; i < chunks.length; i++) {
            const vectorId = `${id}-${file.path}-${i}`;
            await vectorStorage.storeEmbedding(vectorId, embeddings[i], {
              repoId: id,
              filePath: file.path,
              fileId: i,
              language: extension.slice(1) || "text",
              lastModified: new Date().toISOString(),
            });
          }

          // Attempt to get existing file, handle if it doesn't exist
          let repoFile;
          try {
            repoFile = await storage.getRepoFile(id, file.path);
          } catch (error) {
            console.log(
              `File ${file.path} not found in the database, will create it`
            );
          }

          if (repoFile) {
            // Update the file in database
            await storage.updateRepoFile(repoFile.id, {
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
      const id = getIdFromParams(req, res);
      const { docType, query, model = "gpt-4o" } = req.body;

      const repoDoc = await storage.getRepoDoc(id);

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
              result.metadata.filePath
            );
            return file;
          })
        );
      } else {
        // Otherwise use all files
        relevantFiles = await storage.getRepoFiles(id);
      }

      if (!relevantFiles.length) {
        res.status(404).json({ error: "No analyzed files found" });
        return;
      }

      console.log("Relevant files found:", relevantFiles.length);

      // Try to get CFG data if it exists
      let cfgContent = "";
      try {
        const cfgDocs = await storage.getRepoDocs(id);
        const cfgDoc = cfgDocs.find((doc) => doc.docType === "cfg");
        if (cfgDoc) {
          console.log("CFG data found, including in documentation generation");
          cfgContent = cfgDoc.content;
        }
      } catch (error) {
        console.log("No CFG data found, proceeding without it");
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

      const { content: documentation, prompts } = await generateDocumentation(
        codeWithCfg,
        `Generate ${docType} documentation`,
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
      const id = getIdFromParams(req, res);
      const docs = await storage.getRepoDocs(id);

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

      res.json(sortedDocs[0]);
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
      const id = getIdFromParams(req, res);
      const repo = await getRepoById(id, res);
      if (!repo) return;

      // Get all files in the repository
      const repoFiles = await storage.getRepoFiles(id);

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
      const existingDocs = await storage.getRepoDocs(id);
      const cfgDoc = existingDocs.find((doc) => doc.docType === "cfg");

      // Store the generated CFG
      const doc = cfgDoc
        ? await storage.updateRepoDoc(cfgDoc.id, {
            repoId: id,
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
      const id = getIdFromParams(req, res);
      const docs = await storage.getRepoDocs(id);

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
}

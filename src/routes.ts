import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertPrdSchema } from "@shared/schema";
import { getRepoContent, listUserRepos } from "./lib/github";
import { generateDocumentation } from "./lib/openai";
import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import fetch from "node-fetch";
import { processFileContent, generateEmbedding } from "./lib/embeddings";
import { vectorStorage } from "./lib/vector-storage";
import { extname } from "path";
import {
  generateCFG,
  visualizeCallGraph,
  visualizeControlFlowGraphs,
} from "./lib/cfg-analyzer";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface GithubTokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
}

export async function registerRoutes(app: Express): Promise<Server> {
  // Serve static files from the correct build output directory
  app.use(express.static(path.join(__dirname, "../dist/public")));

  // PRD routes
  app.get("/api/prds", async (_req, res) => {
    try {
      const prds = await storage.getPrds();
      res.json(prds);
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to fetch PRDs";
      res.status(500).json({ error: message });
    }
  });

  app.get("/api/prds/:id", async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid PRD ID" });
      return;
    }

    const prd = await storage.getPrd(id);
    if (!prd) {
      res.status(404).json({ error: "PRD not found" });
      return;
    }

    res.json(prd);
  });

  app.get("/api/prds/search", async (req, res) => {
    try {
      const query = req.query.q as string;
      const results = await storage.searchPrds(query);
      res.json(results);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Search failed";
      res.status(500).json({ error: message });
    }
  });

  app.post("/api/prds", async (req, res) => {
    try {
      const result = insertPrdSchema.safeParse(req.body);
      if (!result.success) {
        res.status(400).json({
          error: "Invalid PRD data",
          details: result.error.issues,
        });
        return;
      }

      const prd = await storage.createPrd(result.data);
      res.json(prd);
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to create PRD";
      res.status(500).json({ error: message });
    }
  });

  app.delete("/api/prds/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        res.status(400).json({ error: "Invalid PRD ID" });
        return;
      }

      await storage.deletePrd(id);
      res.status(204).end();
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to delete PRD";
      res.status(500).json({ error: message });
    }
  });

  // Add PATCH endpoint for updating PRDs
  app.patch("/api/prds/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        res.status(400).json({ error: "Invalid PRD ID" });
        return;
      }

      const result = insertPrdSchema.safeParse(req.body);
      if (!result.success) {
        res.status(400).json({
          error: "Invalid PRD data",
          details: result.error.issues,
        });
        return;
      }

      const prd = await storage.updatePrd(id, result.data);
      res.json(prd);
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to update PRD";
      res.status(500).json({ error: message });
    }
  });

  // GitHub OAuth routes
  app.get("/api/github/login", (req, res) => {
    const redirectUri = `https://${req.hostname}/repos`;
    const githubAuthUrl = `https://github.com/login/oauth/authorize?client_id=${process.env.GITHUB_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=repo`;
    res.json({ url: githubAuthUrl });
  });

  // API endpoint for completing OAuth
  app.get("/api/github/complete-oauth", async (req, res) => {
    const { code } = req.query;

    if (!code || typeof code !== "string") {
      res.status(400).json({ error: "No code provided" });
      return;
    }

    try {
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
            redirect_uri: `https://${req.hostname}/repos`,
          }),
        },
      );

      console.log("GitHub token response status:", tokenRes.status);

      if (!tokenRes.ok) {
        throw new Error(`GitHub token exchange failed: ${tokenRes.statusText}`);
      }

      const data = (await tokenRes.json()) as GithubTokenResponse;
      console.log("GitHub token response:", {
        error: data.error,
        error_description: data.error_description,
        has_token: !!data.access_token,
      });

      if (data.error) {
        throw new Error(data.error_description || data.error);
      }

      if (!data.access_token) {
        throw new Error("No access token received from GitHub");
      }

      console.log("Saving GitHub auth to database...");
      await storage.saveGithubAuth({
        accessToken: data.access_token,
      });
      console.log("GitHub auth saved successfully");

      res.json({ success: true });
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to authenticate with GitHub";
      res.status(500).json({ error: message });
    }
  });

  // GitHub repository management routes
  app.get("/api/github/repos", async (_req, res) => {
    try {
      const repos = await storage.getRepos();
      res.json(repos);
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to fetch repositories";
      res.status(500).json({ error: message });
    }
  });

  app.get("/api/github/available-repos", async (req, res) => {
    try {
      const auth = await storage.getGithubAuth();
      if (!auth) {
        res.status(401).json({ error: "GitHub not authenticated" });
        return;
      }

      const availableRepos = await listUserRepos(auth.accessToken);

      // Filter out already imported repos
      const existingRepos = await storage.getRepos();
      const existingRepoIds = new Set(existingRepos.map((r) => r.repoId));

      const filteredRepos = availableRepos.filter(
        (repo) => !existingRepoIds.has(String(repo.repoId)),
      );

      res.json(filteredRepos);
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to fetch available repositories";
      res.status(500).json({ error: message });
    }
  });

  app.post("/api/github/import-repos", async (req, res) => {
    try {
      const auth = await storage.getGithubAuth();
      if (!auth) {
        res.status(401).json({ error: "GitHub not authenticated" });
        return;
      }

      const { repositories } = req.body;
      if (!Array.isArray(repositories)) {
        res.status(400).json({ error: "Invalid repositories format" });
        return;
      }

      const createdRepos = await Promise.all(
        repositories.map((repo) =>
          storage.createRepo({
            ...repo,
            accessToken: auth.accessToken,
          }),
        ),
      );

      res.json(createdRepos);
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to import repositories";
      res.status(500).json({ error: message });
    }
  });

  app.delete("/api/github/repos/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        res.status(400).json({ error: "Invalid repository ID" });
        return;
      }

      await storage.deleteRepo(id.toString());
      res.status(204).end();
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to delete repository";
      res.status(500).json({ error: message });
    }
  });

  app.get("/api/github/repos/:id", async (req, res) => {
    try {
      const id = req.params.id;

      const data = await storage.getRepo(id);
      res.json(data);
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to delete repository";
      res.status(500).json({ error: message });
    }
  });

  app.get("/api/github/repos/:id/embeddings", async (req, res) => {
    try {
      const id = req.params.id;

      const data = await storage.getRepoFiles(id);
      res.json(data);
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to delete repository";
      res.status(500).json({ error: message });
    }
  });

  // Add new route for GitHub auth status
  app.get("/api/github/auth", async (_req, res) => {
    try {
      const auth = await storage.getGithubAuth();
      res.json(auth || null);
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to get GitHub auth status";
      res.status(500).json({ error: message });
    }
  });

  // Endpoint to analyze repository files
  app.post("/api/repos/:repoId/analyze", async (req, res) => {
    try {
      const { repoId } = req.params;
      const repo = await storage.getRepo(repoId);

      if (!repo) {
        res.status(404).json({ error: "Repository not found" });
        return;
      }

      const repoContent = await getRepoContent(
        repo.accessToken,
        `https://github.com/${repo.fullName}`,
      );

      // Process each file
      for (const file of repoContent) {
        try {
          const extension = extname(file.path).toLowerCase();

          // Process the file content and generate embeddings
          const { chunks, embeddings } = await processFileContent(file.content);

          // Store each chunk with its embedding in vector storage
          for (let i = 0; i < chunks.length; i++) {
            const vectorId = `${repoId}-${file.path}-${i}`;
            await vectorStorage.storeEmbedding(vectorId, embeddings[i], {
              repoId,
              filePath: file.path,
              fileId: i,
              language: extension.slice(1) || "text",
              lastModified: new Date().toISOString(),
            });
          }

          // Attempt to get existing file, handle if it doesn't exist
          let repoFile;
          try {
            repoFile = await storage.getRepoFile(repoId, file.path);
          } catch (error) {
            console.log(
              `File ${file.path} not found in the database, will create it`,
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
              repoId,
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
            `${index + 1}/${repoContent.length}`,
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
  app.post("/api/repos/:repoId/generate-docs", async (req, res) => {
    try {
      const { repoId } = req.params;
      const { docType, query, model = "gpt-4o" } = req.body;

      const repoDoc = await storage.getRepoDoc(repoId);

      // If a specific query is provided, use vector search to find relevant files
      let relevantFiles;
      if (query) {
        const queryEmbedding = await generateEmbedding(query);
        const similarResults = await vectorStorage.searchSimilar(
          queryEmbedding,
          repoId,
          10,
        );
        relevantFiles = await Promise.all(
          similarResults.map(async (result) => {
            const file = await storage.getRepoFile(
              repoId,
              result.metadata.filePath,
            );
            return file;
          }),
        );
      } else {
        // Otherwise use all files
        relevantFiles = await storage.getRepoFiles(repoId);
      }

      if (!relevantFiles.length) {
        res.status(404).json({ error: "No analyzed files found" });
        return;
      }

      console.log("Relevant files found:", relevantFiles.length);

      // Try to get CFG data if it exists
      let cfgContent = "";
      try {
        const cfgDocs = await storage.getRepoDocs(repoId);
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
            `File: ${file!.filePath}\n\n${JSON.stringify(file!.metadata, null, 2)}\n\nContent:\n${file!.content || "No content available"}`,
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
        model as "gpt-4o" | "gpt-3.5-turbo" | "o1-mini",
      );

      console.log("Documentation generated");

      // Store the generated documentation with actual prompts in metadata
      const doc = repoDoc
        ? await storage.updateRepoDoc(repoDoc.id, {
            repoId,
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
            repoId,
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

  // Endpoint to search similar files
  app.post("/api/repos/:repoId/search", async (req, res) => {
    try {
      const { repoId } = req.params;
      const { query } = req.body;

      // Generate embedding for the search query
      const queryEmbedding = await generateEmbedding(query);

      // Search for similar vectors in vector storage
      const results = await vectorStorage.searchSimilar(
        queryEmbedding,
        repoId,
        5,
      );

      // Fetch the actual content for the matches
      const enrichedResults = await Promise.all(
        results.map(async (result) => {
          // Use the proper parameters for getRepoFile
          const file = await storage.getRepoFile(
            result.metadata.repoId,
            result.metadata.filePath,
          );
          return {
            ...result,
            content: file?.content || "",
            filePath: file?.filePath || "",
          };
        }),
      );

      res.json(enrichedResults);
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to search repository";
      res.status(500).json({ error: message });
    }
  });

  // Add new route to get previously generated documentation
  app.get("/api/repos/:repoId/docs", async (req, res) => {
    try {
      const { repoId } = req.params;
      const docs = await storage.getRepoDocs(repoId);

      // Sort by updatedAt to get the most recent doc
      const sortedDocs = docs.sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
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
  app.post("/api/repos/:repoId/generate-cfg", async (req, res) => {
    try {
      const { repoId } = req.params;
      const repo = await storage.getRepo(repoId);

      if (!repo) {
        res.status(404).json({ error: "Repository not found" });
        return;
      }

      // Get all files in the repository
      const repoFiles = await storage.getRepoFiles(repoId);

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
      const existingDocs = await storage.getRepoDocs(repoId);
      const cfgDoc = existingDocs.find((doc) => doc.docType === "cfg");

      // Store the generated CFG
      const doc = cfgDoc
        ? await storage.updateRepoDoc(cfgDoc.id, {
            repoId,
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
            repoId,
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
  app.get("/api/repos/:repoId/cfg", async (req, res) => {
    try {
      const { repoId } = req.params;
      const docs = await storage.getRepoDocs(repoId);

      // Find the most recent CFG document
      const cfgDocs = docs
        .filter((doc) => doc.docType === "cfg")
        .sort(
          (a, b) =>
            new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
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

  const httpServer = createServer(app);
  return httpServer;
}

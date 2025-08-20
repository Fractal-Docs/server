import type { Express } from "express";

import { storage } from "src/storage";
import { type ModelType } from "../ai-providers";
import { generateEmbedding } from "../embeddings";
import { getParams } from "../helpers";
import { generateDocumentation } from "../openai";
import { vectorStorage } from "../vector-storage";

async function getRepoById(id: string, res) {
  const data = await storage.getRepo(id);
  if (!data) {
    res.status(404).json({ error: "No repository found" });
    return;
  }

  return data;
}

export function documentsRoutes(app: Express) {
  // Endpoint to generate documentation
  app.post(
    "/api/organization/:org_id/repos/:repo_id/generate-docs",
    async (req, res) => {
      try {
        const { org_id, repo_id, branch } = getParams(req, res, [
          "org_id",
          "repo_id",
          "branch",
        ]);
        const organization = await storage.getOrganization(org_id);
        if (!organization) {
          res.status(404).json({ error: "Organization not found" });
          return;
        }
        const repo = await getRepoById(repo_id, res);
        if (!repo) {
          res.status(404).json({ error: "Repo not found" });
          return;
        } else if (repo.organizationId !== organization.id) {
          res.status(403).json({ error: "Repo not part of organization" });
          return;
        }
        const { docType, query, model = "gpt-4o" } = req.body;

        const repoDoc = await storage.getRepoDoc(repo_id, branch, docType);

        // If a specific query is provided, use vector search to find relevant files
        let relevantFiles;
        if (query) {
          const queryEmbedding = await generateEmbedding(query);
          const similarResults = await vectorStorage.searchSimilar(
            queryEmbedding,
            repo_id,
            10
          );
          relevantFiles = await Promise.all(
            similarResults.map(async (result) => {
              const file = await storage.getRepoFile(
                repo_id,
                result.metadata.filePath,
                branch
              );
              return file;
            })
          );
        } else {
          // Otherwise use all files
          relevantFiles = await storage.getRepoFiles(repo_id, branch);
        }

        if (!relevantFiles.length) {
          res.status(404).json({ error: "No analyzed files found" });
          return;
        }

        console.log("Relevant files found:", relevantFiles.length);

        // Try to get CFG data if it exists
        let cfgContent = "";
        try {
          const cfgDocs = await storage.getRepoDocsByBranch(repo_id, branch);
          const cfgDoc = cfgDocs.find((doc) => doc.docType === "cfg");
          if (cfgDoc) {
            console.log(
              "CFG data found, including in documentation generation"
            );
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

        const prd = await storage.getPrdForBranch(repo_id, branch);
        const businessContext = prd
          ? `PRD Business Context: ${prd?.businessContext}\n\n PRD Content: ${prd?.content}`
          : "";

        const { content: documentation, prompts } = await generateDocumentation(
          codeWithCfg,
          businessContext,
          model as ModelType
        );

        console.log("Documentation generated");

        // Store the generated documentation with actual prompts in metadata
        const doc = repoDoc
          ? await storage.updateRepoDoc(repoDoc.id, {
              repoId: repo_id,
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
              repoId: repo_id,
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
    }
  );

  app.get("/api/organization/:org_id/repos/:repo_id/docs", async (req, res) => {
    try {
      const { org_id, repo_id, branch } = getParams(req, res, [
        "org_id",
        "repo_id",
        "branch",
      ]);
      const organization = await storage.getOrganization(org_id);
      if (!organization) {
        res.status(404).json({ error: "Organization not found" });
        return;
      }
      const repo = await getRepoById(repo_id, res);
      if (!repo) {
        res.status(404).json({ error: "Repo not found" });
        return;
      } else if (repo.organizationId !== organization.id) {
        res.status(403).json({ error: "Repo not part of organization" });
        return;
      }
      const docs = await storage.getRepoDocsByBranch(repo_id, branch);

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

  app.get("/api/organization/:org_id/recent-documents", async (req, res) => {
    try {
      const { org_id } = getParams(req, res, ["org_id"]);
      const organization = await storage.getOrganization(org_id);
      if (!organization) {
        res.status(404).json({ error: "Organization not found" });
        return;
      }
      console.log("Fetching docs...");
      const docs = await storage.getOrganizationDocs(org_id);

      console.log("Filtering docs...", docs);
      const recentDocs = docs
        .sort(
          (a, b) =>
            new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        )
        .slice(0, 10);
      console.log("Filtered docs:", recentDocs);

      res.json(recentDocs.filter(Boolean));
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to fetch recent documents";
      res.status(500).json({ error: message });
    }
  });
}

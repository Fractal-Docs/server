import type { Express } from "express";
import { db } from "src/db";
import { releases } from "src/shared/schema";
import { nanoid } from "nanoid";
import { storage } from "src/storage";
import { type ModelType } from "../ai-providers";
import {
  analyzeDiff,
  generateReleaseDocument,
  generateRoleDocument,
  generateRoleDocumentWithContext,
} from "../releases";

export function releaseRoutes(app: Express) {
  app.post("/api/releases", async (req, res) => {
    try {
      const { title, prd, repoId, branch, model = "gpt-4o" } = req.body;
      const diffAnalysis = await analyzeDiff(repoId, branch);

      const releaseDocument = await generateReleaseDocument(
        prd,
        diffAnalysis,
        model as ModelType
      );

      const salesDocument = await generateRoleDocument(
        releaseDocument,
        "sales",
        model as ModelType
      );
      const marketingDocument = await generateRoleDocument(
        releaseDocument,
        "marketing",
        model as ModelType
      );
      const customerSuccessDocument = await generateRoleDocument(
        releaseDocument,
        "customer-success",
        model as ModelType
      );

      const releaseId = nanoid();

      const newRelease = await storage.createRelease({
        releaseId,
        title,
        prd,
        repoId,
        branch,
        diffAnalysis,
        releaseDocument,
        salesDocument,
        marketingDocument,
        customerSuccessDocument,
      });

      res.json(newRelease);
    } catch (error) {
      console.error("Error creating release:", error);
      res.status(500).json({
        error:
          error instanceof Error ? error.message : "Failed to create release",
      });
    }
  });

  app.get("/api/releases", async (req, res) => {
    try {
      // need to get the releases for a users repos
      const allReleases = await db
        .select()
        .from(releases)
        .orderBy(releases.createdAt);
      res.json(allReleases);
    } catch (error) {
      console.error("Error fetching releases:", error);
      res.status(500).json({ error: "Failed to fetch releases" });
    }
  });

  app.get("/api/releases/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const release = await storage.getRelease(id);

      if (!release) {
        res.status(404).json({ error: "Release not found" });
      }

      res.json(release);
    } catch (error) {
      console.error("Error fetching release:", error);
      res.status(500).json({ error: "Failed to fetch release" });
    }
  });

  app.post("/api/releases/:id/generate-roles", async (req: any, res: any) => {
    try {
      const { id } = req.params;
      const { roles: selectedRoles } = req.body;

      const release = await storage.getRelease(id);

      if (!release) {
        return res.status(404).json({ error: "Release not found" });
      }

      const roleDocuments: Record<string, string> = {};

      for (const role of selectedRoles) {
        try {
          const document = await generateRoleDocumentWithContext(
            release.releaseDocument,
            role
          );
          roleDocuments[role] = document;
        } catch (error) {
          console.error(`Error generating document for role ${role}:`, error);
          roleDocuments[role] =
            `<p>Error generating ${role} document: ${error instanceof Error ? error.message : "Unknown error"}</p>`;
        }
      }

      const updateData: any = {
        roleDocuments: { ...(release.roleDocuments || {}), ...roleDocuments },
      };

      if (selectedRoles.includes("csm")) {
        updateData.csmDocument = roleDocuments.csm;
      }
      if (selectedRoles.includes("revops")) {
        updateData.revopsDocument = roleDocuments.revops;
      }
      if (selectedRoles.includes("ps")) {
        updateData.psDocument = roleDocuments.ps;
      }

      const updatedRelease = await storage.updateRelease(id, updateData);

      res.json(updatedRelease);
    } catch (error) {
      console.error("Error generating role documents:", error);
      res.status(500).json({
        error:
          error instanceof Error
            ? error.message
            : "Failed to generate role documents",
      });
    }
  });
}

import type { Express } from "express";
import { db } from "src/db";
import { releases } from "src/shared/schema";
import { nanoid } from "nanoid";
import { storage } from "src/storage";
import {
  analyzeDiff,
  generateReleaseDocument,
  generateRoleDocument,
} from "src/lib/releases";

export function releaseRoutes(app: Express) {
  app.post("/api/releases", async (req, res) => {
    try {
      const { title, prd, repoId, branch } = req.body;
      const diffAnalysis = await analyzeDiff(repoId, branch);

      const releaseDocument = await generateReleaseDocument(prd, diffAnalysis);

      const salesDocument = await generateRoleDocument(
        releaseDocument,
        "sales"
      );
      const marketingDocument = await generateRoleDocument(
        releaseDocument,
        "marketing"
      );
      const customerSuccessDocument = await generateRoleDocument(
        releaseDocument,
        "customer-success"
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
}

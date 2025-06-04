import type { Express } from "express";
import { insertPrdSchema } from "src/shared/schema";
import { storage } from "src/storage";

export function prdRoutes(app: Express) {
  // PRD routes
  app.get("/api/prds", async (req, res) => {
    try {
      const userSub = req.headers["user-sub"] as string;
      if (!userSub) {
        res.status(401).json({ error: "User sub not provided" });
        return;
      }
      const user = await storage.getUser(userSub as string);
      if (!user || !user.accessToken) {
        res.status(401).json({ error: "GitHub not authenticated" });
        return;
      }
      const prds = await storage.getPrds(user.repos || []);
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
      const userSub = req.headers["user-sub"] as string;
      if (!userSub) {
        res.status(401).json({ error: "User sub not provided" });
        return;
      }
      const user = await storage.getUser(userSub as string);
      if (!user || !user.accessToken) {
        res.status(401).json({ error: "GitHub not authenticated" });
        return;
      }
      const query = req.query.q as string;
      const results = await storage.searchPrds(user.repos, query);
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
}

import type { Express } from "express";

import { getAccessToken, getUserRoles } from "../auth0";
import { storage } from "src/storage";

export function authRoutes(app: Express) {
  app.get("/api/user", async (req, res) => {
    try {
      const userSub = req.headers["user-sub"] as string;
      const user = await storage.getUser(userSub);
      res.json(user);
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to fetch repositories";
      res.status(500).json({ error: message });
    }
  });

  app.get("/api/auth/roles", async (req, res) => {
    try {
      const accessToken = await getAccessToken();
      const userSub = req.headers["user-sub"] as string;
      const roles = await getUserRoles(accessToken, userSub as string);
      res.json(roles);
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to fetch repositories";
      res.status(500).json({ error: message });
    }
  });
}

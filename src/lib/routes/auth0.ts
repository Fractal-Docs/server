import type { Express } from "express";

import { getAccessToken, getUserRoles } from "../auth0";

export function auth0Routes(app: Express) {
  app.get("/api/auth0/roles", async (req, res) => {
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

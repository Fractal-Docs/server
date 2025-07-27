import type { Express } from "express";
import { createServer, type Server } from "http";
import { prdRoutes } from "./lib/routes/prd";
import { githubRoutes } from "./lib/routes/github";
import { codeRoutes } from "./lib/routes/code";
import { authRoutes } from "./lib/routes/auth";
import { releaseRoutes } from "./lib/routes/releases";
import { organizationRoutes } from "./lib/routes/organizations";

export async function registerRoutes(app: Express): Promise<Server> {
  prdRoutes(app);
  githubRoutes(app);
  codeRoutes(app);
  authRoutes(app);
  releaseRoutes(app);
  organizationRoutes(app);

  const httpServer = createServer(app);
  return httpServer;
}

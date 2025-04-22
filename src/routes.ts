import type { Express } from "express";
import { createServer, type Server } from "http";
import { prdRoutes } from "./lib/routes/prd";
import { githubRoutes } from "./lib/routes/github";
import { codeRoutes } from "./lib/routes/code";

export async function registerRoutes(app: Express): Promise<Server> {
  prdRoutes(app);
  githubRoutes(app);
  codeRoutes(app);

  const httpServer = createServer(app);
  return httpServer;
}

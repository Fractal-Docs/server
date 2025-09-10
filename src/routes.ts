import type { Express } from "express";
import { prdRoutes } from "./lib/routes/prd";
import { githubRoutes } from "./lib/routes/github";
import { codeRoutes } from "./lib/routes/code";
import { authRoutes } from "./lib/routes/auth";
import { releaseRoutes } from "./lib/routes/releases";
import { organizationRoutes } from "./lib/routes/organizations";
import { documentsRoutes } from "./lib/routes/documents";

export async function registerProtectedRoutes(app: Express): Promise<void> {
  prdRoutes(app);
  githubRoutes(app);
  codeRoutes(app);
  releaseRoutes(app);
  organizationRoutes(app);
  documentsRoutes(app);
  authRoutes(app);
}

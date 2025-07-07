import express, { NextFunction, type Request, Response } from "express";
import cors from "cors";
import { env, isProduction, validateEnvironment } from "./config/env";

// Validate environment variables
validateEnvironment();

// Only import supabase-keep-alive in production
if (isProduction()) {
  import("./supabase-keep-alive");
}

import { registerRoutes } from "./routes";

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cors({ origin: true, credentials: true }));

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 200) {
        logLine = logLine.slice(0, 199) + "…";
      }

      console.log(logLine);
    }
  });

  next();
});

(async () => {
  const server = await registerRoutes(app);

  // _next is required here to solve res.status is not a function error
  // Express.js uses the **arity** (number of parameters) to distinguish between:
  // - **Regular middleware**: `(req, res, next) => {}`  (3 parameters)
  // - **Error middleware**: `(err, req, res, next) => {}` (4 parameters)
  // If you have fewer than 4 parameters, Express assumes it's regular middleware
  // and passes `(req, res, next)` instead of `(err, req, res, next)`.
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  const port = env.PORT;
  server.listen({
    port,
    host: "0.0.0.0",
  });
})();

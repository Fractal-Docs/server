import type { Express } from "express";

import { storage } from "src/storage";
import { getRepoBranches, listRepoFileSystem, listUserRepos } from "../github";
import { getParams } from "../helpers";

interface GithubTokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
}

export function githubRoutes(app: Express) {
  // GitHub Ouser routes
  app.get("/api/github/login", (req, res) => {
    const origin = req.get("origin") || "";
    let normalizedOrigin;
    try {
      const url = new URL(
        origin.startsWith("http") ? origin : `https://${origin}`
      );
      normalizedOrigin = url.hostname + (url.port ? `:${url.port}` : "");
    } catch {
      res.status(400).json({ error: "Invalid origin header" });
      return;
    }
    const redirectUri = `https://${normalizedOrigin}/repos`;
    const githubAuthUrl = `https://github.com/login/oauth/authorize?client_id=${process.env.GITHUB_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=repo`;
    res.json({ url: githubAuthUrl });
  });

  // API endpoint for completing OAuth
  app.get("/api/github/complete-oauth", async (req, res) => {
    const { code, userSub } = req.query;

    if (!code || typeof code !== "string") {
      res.status(400).json({ error: "No code provided" });
      return;
    }

    try {
      const origin = req.get("origin") || "";
      let normalizedOrigin;
      try {
        const url = new URL(
          origin.startsWith("http") ? origin : `https://${origin}`
        );
        normalizedOrigin = url.hostname + (url.port ? `:${url.port}` : "");
      } catch {
        res.status(400).json({ error: "Invalid origin header" });
        return;
      }
      const redirectUri = `https://${normalizedOrigin}/repos`;
      const tokenRes = await fetch(
        "https://github.com/login/oauth/access_token",
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            client_id: process.env.GITHUB_CLIENT_ID,
            client_secret: process.env.GITHUB_CLIENT_SECRET,
            code,
            redirect_uri: redirectUri,
          }),
        }
      );

      console.log("GitHub token response status:", tokenRes.status);

      if (!tokenRes.ok) {
        throw new Error(`GitHub token exchange failed: ${tokenRes.statusText}`);
      }

      const data = (await tokenRes.json()) as GithubTokenResponse;
      console.log("GitHub token response:", {
        error: data.error,
        error_description: data.error_description,
        has_token: !!data.access_token,
      });

      if (data.error) {
        throw new Error(data.error_description || data.error);
      }

      if (!data.access_token) {
        throw new Error("No access token received from GitHub");
      }

      console.log("Saving GitHub user to database...");
      const user = await storage.getUser(userSub as string);
      if (user) {
        await storage.updateUser({
          accessToken: data.access_token,
          userSub: userSub as string,
        });
      } else {
        await storage.createUser({
          accessToken: data.access_token,
          userSub: userSub as string,
        });
      }
      console.log("GitHub user saved successfully");

      res.json({ success: true });
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to authenticate with GitHub";
      res.status(500).json({ error: message });
    }
  });

  // Gets repos for Ouser token
  app.get("/api/github/available-repos", async (req, res) => {
    const userSub = req.headers["user-sub"] as string;
    try {
      if (!userSub) {
        res.status(401).json({ error: "User sub not provided" });
        return;
      }
      const user = await storage.getUser(userSub as string);
      if (!user || !user.accessToken) {
        res.status(401).json({ error: "GitHub not authenticated" });
        return;
      }

      const availableRepos = await listUserRepos(user.accessToken);

      // Filter out already imported repos
      const existingRepos = await storage.getRepos(user.repos);
      const existingRepoIds = new Set(existingRepos.map((r) => r.repoId));

      const filteredRepos = availableRepos.filter(
        (repo) => !existingRepoIds.has(String(repo.repoId))
      );

      res.json(filteredRepos);
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to fetch available repositories";
      res.status(500).json({ error: message });
    }
  });

  // Add new route for GitHub user status
  app.get("/api/github/auth", async (req, res) => {
    const userSub = req.headers["user-sub"] as string;
    try {
      if (!userSub) {
        res.status(401).json({ error: "User sub not provided" });
        return;
      }
      const user = await storage.getUser(userSub as string);
      res.json(user || null);
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to get GitHub user status";
      res.status(500).json({ error: message });
    }
  });

  app.post("/api/github/import-repos", async (req, res) => {
    const userSub = req.headers["user-sub"] as string;
    try {
      if (!userSub) {
        res.status(401).json({ error: "User sub not provided" });
        return;
      }
      const user = await storage.getUser(userSub as string);
      if (!user) {
        res.status(401).json({ error: "GitHub not authenticated" });
        return;
      }

      const { repositories } = req.body;
      if (!Array.isArray(repositories)) {
        res.status(400).json({ error: "Invalid repositories format" });
        return;
      }

      const createdRepos = await Promise.all(
        repositories.map((repo) =>
          storage.createRepo({
            ...repo,
            accessToken: user.accessToken,
          })
        )
      );

      await storage.updateUser({
        userSub,
        repos: [...(user.repos || []), ...createdRepos.map((r) => r.repoId)],
      });

      res.json(createdRepos);
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to import repositories";
      res.status(500).json({ error: message });
    }
  });

  app.get("/api/github/repos/:id/files", async (req, res) => {
    try {
      const userSub = req.headers["user-sub"] as string;
      const { id, branch } = getParams(req, res);
      if (!userSub) {
        res.status(401).json({ error: "User sub not provided" });
        return;
      }
      const user = await storage.getUser(userSub as string);
      if (!user || !user.accessToken) {
        res.status(401).json({ error: "GitHub not authenticated" });
        return;
      }

      const repo = await storage.getRepo(id);

      if (!repo) {
        res.status(404).json({ error: "Repository not found" });
        return;
      }

      // Utilize the listRepoFileSystem function from /github
      const fileSystem = await listRepoFileSystem(
        user.accessToken,
        `https://github.com/${repo.fullName}`,
        branch
      );
      res.status(200).json(fileSystem);
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to list repository files";
      res.status(500).json({ error: message });
    }
  });

  app.get("/api/github/repos/:id/branches", async (req, res) => {
    try {
      const userSub = req.headers["user-sub"] as string;
      const { id } = getParams(req, res);
      if (!userSub) {
        res.status(401).json({ error: "User sub not provided" });
        return;
      }
      const user = await storage.getUser(userSub as string);
      if (!user || !user.accessToken) {
        res.status(401).json({ error: "GitHub not authenticated" });
        return;
      }

      const repo = await storage.getRepo(id);

      if (!repo) {
        res.status(404).json({ error: "Repository not found" });
        return;
      }

      const branches = await getRepoBranches(
        user.accessToken,
        `https://github.com/${repo.fullName}`
      );
      res.json(branches);
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to list repository files";
      res.status(500).json({ error: message });
    }
  });
}

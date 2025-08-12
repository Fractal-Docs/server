import type { Express } from "express";

import { storage } from "src/storage";
import {
  getRepoBranches,
  listRepoFileSystem,
  listOrganizationRepos,
} from "../github";
import { getOrigin, getParams } from "../helpers";

interface GithubTokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
}

export function githubRoutes(app: Express) {
  // GitHub Ouser routes
  app.get("/api/github/login", (req, res) => {
    const { origin, normalizedOrigin } = getOrigin(req, res);
    if (!origin || !normalizedOrigin) {
      return;
    }
    const redirectUri = origin.startsWith("https")
      ? `https://${normalizedOrigin}/repos`
      : `http://${normalizedOrigin}/repos`;
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

    if (!userSub) {
      res.status(400).json({ error: "User sub not provided" });
      return;
    }

    try {
      const { origin, normalizedOrigin } = getOrigin(req, res);
      if (!origin || !normalizedOrigin) {
        return;
      }
      const redirectUri = origin.startsWith("https")
        ? `https://${normalizedOrigin}/repos`
        : `http://${normalizedOrigin}/repos`;
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

      if (data.error) {
        throw new Error(data.error_description || data.error);
      }

      if (!data.access_token) {
        throw new Error("No access token received from GitHub");
      }

      const user = await storage.getUser(userSub as string);
      if (user) {
        // TODO: update the organization with the access token
        await storage.updateUser({
          // accessToken: data.access_token,
          userSub: userSub as string,
        });
      } else {
        // TODO: the organization with the access token
        await storage.createUser({
          // accessToken: data.access_token,
          userSub: userSub as string,
          name: "",
          email: "",
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
    try {
      const orgSlug = req.headers["org-slug"] as string;
      if (!orgSlug) {
        res.status(401).json({ error: "Organization not provided" });
        return;
      }
      const organization = await storage.getOrganizationBySlug(orgSlug);
      if (!organization) {
        res.status(404).json({ error: "Organization not found" });
        return;
      }

      const availableRepos = await listOrganizationRepos(
        organization.accessToken,
        organization.name
      );

      // Filter out already imported repos
      const existingRepos = await storage.getRepos(organization.id);
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
    try {
      const orgSlug = req.headers["org-slug"] as string;
      if (!orgSlug) {
        res.status(401).json({ error: "Organization not provided" });
        return;
      }
      const organization = await storage.getOrganizationBySlug(orgSlug);
      if (!organization) {
        res.status(404).json({ error: "Organization not found" });
        return;
      }
      res.json(organization || null);
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to get GitHub user status";
      res.status(500).json({ error: message });
    }
  });

  app.post("/api/github/import-repos", async (req, res) => {
    try {
      const orgSlug = req.headers["org-slug"] as string;
      if (!orgSlug) {
        res.status(401).json({ error: "Organization not provided" });
        return;
      }
      const organization = await storage.getOrganizationBySlug(orgSlug);
      if (!organization) {
        res.status(404).json({ error: "Organization not found" });
        return;
      }

      const { repositories } = req.body;
      if (!Array.isArray(repositories)) {
        res.status(400).json({ error: "Invalid repositories format" });
        return;
      }

      const existingRepos = await storage.getRepos(organization.id);
      const existingRepoIds = new Set(existingRepos.map((r) => r.repoId));

      const filteredRepos = repositories.filter(
        (repo) => !existingRepoIds.has(repo.repoId)
      );

      const createdRepos = await Promise.all(
        filteredRepos.map((repo) =>
          storage.createRepo({ ...repo, organizationId: organization.id })
        )
      );

      res.json(createdRepos);
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to import repositories";
      res.status(500).json({ error: message });
    }
  });

  app.get("/api/github/repos/:repo_id/files", async (req, res) => {
    try {
      const { repo_id, branch } = getParams(req, res, ["repo_id", "branch"]);
      const orgSlug = req.headers["org-slug"] as string;
      if (!orgSlug) {
        res.status(401).json({ error: "Organization not provided" });
        return;
      }
      const organization = await storage.getOrganizationBySlug(orgSlug);
      if (!organization) {
        res.status(404).json({ error: "Organization not found" });
        return;
      }

      const repo = await storage.getRepo(repo_id);

      if (!repo) {
        res.status(404).json({ error: "Repository not found" });
        return;
      }

      // Utilize the listRepoFileSystem function from /github
      const fileSystem = await listRepoFileSystem(
        organization.accessToken,
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

  app.get("/api/github/repos/:repo_id/branches", async (req, res) => {
    try {
      const { repo_id } = getParams(req, res, ["repo_id"]);
      const orgSlug = req.headers["org-slug"] as string;
      if (!orgSlug) {
        res.status(401).json({ error: "Organization not provided" });
        return;
      }
      const organization = await storage.getOrganizationBySlug(orgSlug);
      if (!organization) {
        res.status(404).json({ error: "Organization not found" });
        return;
      }

      const repo = await storage.getRepo(repo_id);

      if (!repo) {
        res.status(404).json({ error: "Repository not found" });
        return;
      }

      const branches = await getRepoBranches(
        organization.accessToken,
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

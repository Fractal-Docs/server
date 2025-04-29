import { Octokit } from "@octokit/rest";

interface FileSystemItem {
  path: string;
  type: "file" | "folder";
  children?: FileSystemItem[];
}

export async function getRepoContent(
  accessToken: string,
  repoUrl: string,
  fileRegexString: string,
  branch: string = "main"
): Promise<{ path: string; content: string }[]> {
  const octokit = new Octokit({ auth: accessToken });
  const fileRegex = new RegExp(fileRegexString);

  // Parse repo URL to get owner and repo name
  const [owner, repo] = repoUrl
    .replace("https://github.com/", "")
    .replace(".git", "")
    .split("/");

  // Helper function to check if file path matches regex
  const isMatchingFile = (path: string): boolean => {
    return (
      fileRegex.test(path) &&
      !path.includes(".test.") &&
      !path.includes(".spec.")
    );
  };

  // Recursive function to get content
  async function getContentRecursive(
    path: string = ""
  ): Promise<{ path: string; content: string }[]> {
    try {
      const response = await octokit.repos.getContent({
        owner,
        repo,
        path,
        ref: branch,
      });

      if (!Array.isArray(response.data)) {
        // Single file
        if (isMatchingFile(path)) {
          const content = Buffer.from(
            (response.data as { content: string }).content,
            "base64"
          ).toString();
          return [{ path, content }];
        }
        return [];
      }

      // Directory - process all items
      const promises = response.data.map(async (item) => {
        if (item.type === "dir") {
          // Recursively process directory
          return getContentRecursive(item.path);
        } else if (item.type === "file" && isMatchingFile(item.path)) {
          // Fetch file content if it matches the regex
          const fileResponse = await octokit.repos.getContent({
            owner,
            repo,
            path: item.path,
          });

          if (
            "content" in fileResponse.data &&
            typeof fileResponse.data.content === "string"
          ) {
            return [
              {
                path: item.path,
                content: Buffer.from(
                  fileResponse.data.content,
                  "base64"
                ).toString(),
              },
            ];
          }
        }
        return [];
      });

      const results = await Promise.all(promises);
      return results.flat();
    } catch (error) {
      console.error(`Error processing path ${path}:`, error);
      throw new Error(
        error instanceof Error ? error.message : "Failed to fetch repo content"
      );
    }
  }

  try {
    const files = await getContentRecursive();

    if (files.length === 0) {
      throw new Error("No matching files found in repository");
    }

    return files;
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error occurred";
    throw new Error(`Failed to fetch repo content: ${errorMessage}`);
  }
}

export async function getRepoBranches(
  accessToken: string,
  repoUrl: string
): Promise<string[]> {
  const octokit = new Octokit({ auth: accessToken });
  // Parse repo URL to get owner and repo name
  const [owner, repo] = repoUrl
    .replace("https://github.com/", "")
    .replace(".git", "")
    .split("/");
  try {
    const { data: branches } = await octokit.repos.listBranches({
      owner,
      repo,
    });

    return branches.map((branch) => branch.name);
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error occurred";
    throw new Error(`Failed to fetch repo branches: ${errorMessage}`);
  }
}

export async function listUserRepos(accessToken: string) {
  const octokit = new Octokit({ auth: accessToken });

  try {
    const { data: repos } = await octokit.repos.listForAuthenticatedUser({
      visibility: "all",
      sort: "updated",
      per_page: 100,
    });

    return repos.map((repo) => ({
      name: repo.name,
      fullName: repo.full_name,
      owner: repo.owner.login,
      repoId: repo.id.toString(),
    }));
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error occurred";
    throw new Error(`Failed to list repositories: ${errorMessage}`);
  }
}

export async function listRepoFileSystem(
  accessToken: string,
  repoUrl: string
): Promise<FileSystemItem[]> {
  const octokit = new Octokit({ auth: accessToken });

  const [owner, repo] = repoUrl
    .replace("https://github.com/", "")
    .replace(".git", "")
    .split("/");

  async function fetchFileSystem(path: string = ""): Promise<FileSystemItem[]> {
    try {
      const response = await octokit.repos.getContent({
        owner,
        repo,
        path,
      });

      if (Array.isArray(response.data)) {
        const items = await Promise.all(
          response.data.map(async (item) => {
            const actualFilename = item.path.split("/");
            if (item.type === "dir") {
              const children = await fetchFileSystem(item.path);

              return {
                path: actualFilename[actualFilename.length - 1],
                type: "folder" as FileSystemItem["type"],
                children,
              };
            } else {
              return {
                path: actualFilename[actualFilename.length - 1],
                type: "file" as FileSystemItem["type"],
              };
            }
          })
        );

        // Sort items by type, with folders first, then files, each sorted by path
        items.sort((a, b) => {
          if (a.type === b.type) {
            return a.path.localeCompare(b.path);
          }
          return a.type === "folder" ? -1 : 1;
        });
        items.forEach((item) => {
          if (item.type === "folder" && item.children) {
            item.children.sort((a, b) => {
              if (a.type === b.type) {
                return a.path.localeCompare(b.path);
              }
              return a.type === "folder" ? -1 : 1;
            });
          }
        });

        return items;
      } else {
        throw new Error(`Unexpected response format for path: ${path}`);
      }
    } catch (error) {
      console.error(`Error fetching file system at path ${path}:`, error);
      throw new Error(
        error instanceof Error ? error.message : "Error fetching file system"
      );
    }
  }

  return await fetchFileSystem();
}

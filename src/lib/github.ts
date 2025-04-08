import { Octokit } from "@octokit/rest";

export async function getRepoContent(
  accessToken: string,
  repoUrl: string,
): Promise<{ path: string; content: string }[]> {
  const octokit = new Octokit({ auth: accessToken });

  // Parse repo URL to get owner and repo name
  const [owner, repo] = repoUrl
    .replace("https://github.com/", "")
    .replace(".git", "")
    .split("/");

  // Helper function to check if file is JS/TS
  const isJsOrTs = (path: string): boolean => {
    return /\.(js|jsx|ts|tsx)$/.test(path) && !path.includes('.test.') && !path.includes('.spec.');
  };

  // Recursive function to get content
  async function getContentRecursive(path: string = ''): Promise<{ path: string; content: string }[]> {
    try {
      const response = await octokit.repos.getContent({
        owner,
        repo,
        path,
      });

      if (!Array.isArray(response.data)) {
        // Single file
        if (isJsOrTs(path)) {
          const content = Buffer.from(
            (response.data as { content: string }).content,
            'base64'
          ).toString();
          return [{ path, content }];
        }
        return [];
      }

      // Directory - process all items
      const promises = response.data.map(async (item) => {
        if (item.type === 'dir') {
          // Recursively process directory
          return getContentRecursive(item.path);
        } else if (item.type === 'file' && isJsOrTs(item.path)) {
          // Fetch file content if it's JS/TS
          const fileResponse = await octokit.repos.getContent({
            owner,
            repo,
            path: item.path,
          });

          if ('content' in fileResponse.data && typeof fileResponse.data.content === 'string') {
            return [{
              path: item.path,
              content: Buffer.from(fileResponse.data.content, 'base64').toString(),
            }];
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
      throw new Error("No JavaScript or TypeScript files found in repository");
    }

    return files;
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error occurred";
    throw new Error(`Failed to fetch repo content: ${errorMessage}`);
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
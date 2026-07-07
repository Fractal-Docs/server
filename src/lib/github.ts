import { Octokit } from "@octokit/rest"
import { App } from "@octokit/app"
import { GithubRepo, Organization } from "../shared/schema"

interface FileSystemItem {
  path: string
  type: "file" | "folder"
  children?: FileSystemItem[]
}

const appId = process.env.GITHUB_APP_ID
const privateKey = process.env.GITHUB_APP_PRIVATE_KEY?.replace(/\\n/g, "\n")

async function getGithubAppInstallation(installationId: number) {
  if (!appId || !privateKey) {
    throw new Error("Missing GitHub App ID or Private Key")
  }
  const appOctokit = new App({ appId, privateKey })

  return await appOctokit.getInstallationOctokit(installationId)
}

// Common helper to get authenticated Octokit instance for an organization
async function getOctokit(organization: Organization): Promise<Octokit> {
  if (organization.isPersonal && organization.accessToken) {
    return new Octokit({ auth: organization.accessToken })
  }

  if (organization.installationId) {
    return (await getGithubAppInstallation(
      organization.installationId
    )) as unknown as Octokit
  }

  throw new Error("No GitHub access found for organization")
}

// Helper to parse repository full name into owner and repo
function parseRepoFullName(fullName: string): { owner: string; repo: string } {
  const [owner, repo] = fullName.split("/")
  return { owner, repo }
}

export async function getRepoContent(
  organization: Organization,
  repository: GithubRepo,
  fileRegexString: string,
  branch: string = "main"
): Promise<{ path: string; content: string }[]> {
  const fileRegex = new RegExp(fileRegexString)
  const { owner, repo } = parseRepoFullName(repository.fullName)

  // Helper function to check if file path matches regex
  const isMatchingFile = (path: string): boolean => {
    return (
      fileRegex.test(path) &&
      !path.includes(".test.") &&
      !path.includes(".spec.")
    )
  }

  const octokit = await getOctokit(organization)

  // Recursive function to get content
  async function getContentRecursive(
    path: string = ""
  ): Promise<{ path: string; content: string }[]> {
    try {
      const response = await octokit.request({
        method: "GET",
        url: `/repos/${owner}/${repo}/contents/${path}?ref=${branch}`,
      })

      if (!Array.isArray(response.data)) {
        // Single file
        if (isMatchingFile(path)) {
          const content = Buffer.from(
            (response.data as { content: string }).content,
            "base64"
          ).toString()
          return [{ path, content }]
        }
        return []
      }

      // Directory - process all items
      const promises = response.data.map(async (item) => {
        if (item.type === "dir") {
          // Recursively process directory
          return getContentRecursive(item.path)
        } else if (item.type === "file" && isMatchingFile(item.path)) {
          // Fetch file content if it matches the regex
          const fileResponse = await octokit.request({
            method: "GET",
            url: `/repos/${owner}/${repo}/contents/${item.path}?ref=${branch}`,
          })

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
            ]
          }
        }
        return []
      })

      const results = await Promise.all(promises)
      return results.flat()
    } catch (error) {
      console.error(`Error processing path ${path}:`, error)
      throw new Error(
        error instanceof Error ? error.message : "Failed to fetch repo content"
      )
    }
  }

  try {
    const files = await getContentRecursive()

    if (files.length === 0) {
      throw new Error("No matching files found in repository")
    }

    return files
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error occurred"
    throw new Error(`Failed to fetch repo content: ${errorMessage}`)
  }
}

export async function getRepoBranches(
  organization: Organization,
  repository: GithubRepo
): Promise<string[]> {
  const octokit = await getOctokit(organization)
  const { owner, repo } = parseRepoFullName(repository.fullName)

  try {
    const { data: branches } = await octokit.request({
      method: "GET",
      url: `/repos/${owner}/${repo}/branches`,
    })

    return branches.map((branch) => branch.name)
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error occurred"
    throw new Error(`Failed to fetch repo branches: ${errorMessage}`)
  }
}

export async function listUserRepos(accessToken: string) {
  const octokit = new Octokit({ auth: accessToken })

  try {
    const { data: repos } = await octokit.repos.listForAuthenticatedUser({
      visibility: "all",
      sort: "updated",
      per_page: 100,
      affiliation: "owner",
    })

    return repos.map((repo) => ({
      name: repo.name,
      fullName: repo.full_name,
      owner: repo.owner.login,
      repoId: repo.id.toString(),
    }))
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error occurred"
    throw new Error(`Failed to list repositories: ${errorMessage}`)
  }
}

export async function listOrganizationRepos(installationId: number) {
  const installationOctokit = await getGithubAppInstallation(installationId)
  const { data } = await installationOctokit.request({
    method: "GET",
    url: `/installation/repositories`,
  })

  return data.repositories.map((repo) => ({
    name: repo.name,
    fullName: repo.full_name,
    owner: repo.owner.login,
    repoId: repo.id.toString(),
  }))
}

export async function listRepoFileSystem(
  organization: Organization,
  repository: GithubRepo,
  branch: string
): Promise<FileSystemItem[]> {
  const octokit = await getOctokit(organization)
  const { owner, repo } = parseRepoFullName(repository.fullName)

  async function fetchFileSystem(path: string = ""): Promise<FileSystemItem[]> {
    try {
      const response = await octokit.request({
        method: "GET",
        url: `/repos/${owner}/${repo}/contents/${path}?ref=${branch}`,
      })

      if (Array.isArray(response.data)) {
        const items = await Promise.all(
          response.data.map(async (item) => {
            const actualFilename = item.path.split("/")
            if (item.type === "dir") {
              const children = await fetchFileSystem(item.path)

              return {
                path: actualFilename[actualFilename.length - 1],
                type: "folder" as FileSystemItem["type"],
                children,
              }
            } else {
              return {
                path: actualFilename[actualFilename.length - 1],
                type: "file" as FileSystemItem["type"],
              }
            }
          })
        )

        // Sort items by type, with folders first, then files, each sorted by path
        items.sort((a, b) => {
          if (a.type === b.type) {
            return a.path.localeCompare(b.path)
          }
          return a.type === "folder" ? -1 : 1
        })
        items.forEach((item) => {
          if (item.type === "folder" && item.children) {
            item.children.sort((a, b) => {
              if (a.type === b.type) {
                return a.path.localeCompare(b.path)
              }
              return a.type === "folder" ? -1 : 1
            })
          }
        })

        return items
      } else {
        throw new Error(`Unexpected response format for path: ${path}`)
      }
    } catch (error) {
      console.error(`Error fetching file system at path ${path}:`, error)
      throw new Error(
        error instanceof Error ? error.message : "Error fetching file system"
      )
    }
  }

  return await fetchFileSystem()
}

export async function getGithubRepo(
  organization: Organization,
  repository: GithubRepo
) {
  const { owner, repo } = parseRepoFullName(repository.fullName)
  const octokit = await getOctokit(organization)

  const { data } = await octokit.request({
    method: "GET",
    url: `/repos/${owner}/${repo}`,
  })

  return data
}

export interface CommitDetails {
  sha: string
  message: string
  author: {
    name: string | null
    email: string | null
    date: string | null
  }
  url: string
}

export async function getLatestCommit(
  organization: Organization,
  repository: GithubRepo,
  branch: string
): Promise<CommitDetails> {
  const { owner, repo } = parseRepoFullName(repository.fullName)
  const octokit = await getOctokit(organization)

  const { data } = await octokit.request({
    method: "GET",
    url: `/repos/${owner}/${repo}/commits/${branch}`,
  })

  return {
    sha: data.sha,
    message: data.commit.message,
    author: data.commit.author ?? null,
    url: data.html_url,
  }
}

export async function compareBranches(
  organization: Organization,
  repository: GithubRepo,
  base: string,
  head: string
) {
  const { owner, repo } = parseRepoFullName(repository.fullName)
  const octokit = await getOctokit(organization)

  const basehead = `${base}...${head}`

  const response = await octokit.request({
    method: "GET",
    url: `/repos/${owner}/${repo}/compare/${basehead}`,
  })

  return response
}

export async function compareBranchToDefaultBranch(
  organization: Organization,
  repository: GithubRepo,
  branch: string
) {
  const ghRepo = await getGithubRepo(organization, repository)
  return await compareBranches(
    organization,
    repository,
    ghRepo?.default_branch ?? "",
    branch
  )
}

import { GithubRepo, Organization, Role } from "src/shared/schema"
import { chooseModel, ModelType } from "./ai-providers"
import { DEFAULT_ROLE_CONTEXTS } from "./roles"
import { compareBranchToDefaultBranch } from "./github"

export async function createReleaseDiffAnalysis(
  organization: Organization,
  repo: GithubRepo,
  branch: string
): Promise<string> {
  try {
    const response = await compareBranchToDefaultBranch(
      organization,
      repo,
      branch
    )

    const { data } = response

    let diffSummary = `Comparing main branch to ${branch}:\n\n`
    diffSummary += `Files changed: ${data.files?.length || 0}\n`
    diffSummary += `Commits: ${data.commits?.length || 0}\n\n`

    if (data.files && data.files.length > 0) {
      diffSummary += "Changed files:\n"
      data.files.forEach((file: any) => {
        diffSummary += `- ${file.filename} (+${file.additions} -${file.deletions})\n`
      })
      diffSummary += "\n"
    }

    return diffSummary
  } catch (error) {
    console.error("Error analyzing diff:", error)
    return `Error analyzing diff: ${error instanceof Error ? error.message : "Unknown error"}`
  }
}

export async function prepareReleaseDocumentation(
  prd?: string,
  diffAnalysis?: string
): Promise<{
  developerPrompt: string
  userPrompt: string
  model: ModelType
}> {
  const developerPrompt = `
    You are a technical product manager creating a comprehensive release document.

    **PRD (Product Requirements Document):**
    ${prd}

    **Code Changes Analysis:**
    ${diffAnalysis}

    **Task:** Create a comprehensive release document that combines the PRD requirements with the actual code changes. The document should:

    1. **Release Overview**: Summarize what's being released
    2. **Key Features**: List the main features and improvements
    3. **Technical Changes**: Highlight significant technical changes from the diff
    4. **Business Impact**: Explain the business value and user benefits
    5. **Implementation Notes**: Any important technical details
  `

  const userPrompt = `
    You are a technical product manager creating release documentation.
  `

  const { model } = chooseModel("release", developerPrompt, userPrompt, 0)

  return {
    developerPrompt,
    userPrompt,
    model,
  }
}

export async function prepareRoleDocumentation(
  role: Role,
  customContext?: string,
  releaseDocument?: string
): Promise<{
  developerPrompt: string
  userPrompt: string
  model: ModelType
}> {
  const roleContext = DEFAULT_ROLE_CONTEXTS[role]

  const developerPrompt = `
    ${roleContext}

    **Release Document:**
    ${releaseDocument}

    **Task:** Create a role-specific document that extracts and highlights the information most relevant to this role. Format the response in HTML with proper headings and structure.

    ${customContext ? `Use the following information as additional context for this document: ${customContext}` : ""}
  `

  const userPrompt = `
    You are creating role-specific documentation for a ${role} team. Always respond in well-formatted HTML.
  `
  const { model } = chooseModel("role", developerPrompt, userPrompt, 0, role)

  return {
    developerPrompt,
    userPrompt,
    model,
  }
}

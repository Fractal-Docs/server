import { chooseModel, getAIProvider } from "./ai-providers";
import { DEFAULT_ROLE_CONTEXTS, Role } from "./roles";

export async function analyzeDiff(
  repoId: string,
  branch: string
): Promise<string> {
  try {
    const response = await fetch(
      `${process.env.GITHUB_API_URL || "https://api.github.com"}/repos/${repoId}/compare/main...${branch}`,
      {
        headers: {
          Authorization: `token ${process.env.GITHUB_TOKEN}`,
          Accept: "application/vnd.github.v3+json",
        },
      }
    );

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.statusText}`);
    }

    const data = await response.json();

    let diffSummary = `Comparing main branch to ${branch}:\n\n`;
    diffSummary += `Files changed: ${data.files?.length || 0}\n`;
    diffSummary += `Commits: ${data.commits?.length || 0}\n\n`;

    if (data.files && data.files.length > 0) {
      diffSummary += "Changed files:\n";
      data.files.forEach((file: any) => {
        diffSummary += `- ${file.filename} (+${file.additions} -${file.deletions})\n`;
      });
      diffSummary += "\n";
    }

    if (data.commits && data.commits.length > 0) {
      diffSummary += "Recent commits:\n";
      data.commits.slice(0, 10).forEach((commit: any) => {
        diffSummary += `- ${commit.commit.message.split("\n")[0]}\n`;
      });
    }

    return diffSummary;
  } catch (error) {
    console.error("Error analyzing diff:", error);
    return `Error analyzing diff: ${error instanceof Error ? error.message : "Unknown error"}`;
  }
}

export async function generateReleaseDocument(
  prd: string,
  diffAnalysis: string
): Promise<string> {
  try {
    const prompt = `
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

Format the response in HTML with proper headings and structure for display in a web interface.
`;

    const systemPrompt = `
You are a technical product manager creating release documentation. Always respond in well-formatted HTML.
`;
    const { model } = chooseModel("release", systemPrompt, prompt, 0);

    const provider = getAIProvider(model);
    const content = await provider.generateCompletion(
      systemPrompt,
      prompt,
      model
    );

    return content || "Failed to generate release document";
  } catch (error) {
    console.error("Error generating release document:", error);
    return `<p>Error generating release document: ${error instanceof Error ? error.message : "Unknown error"}</p>`;
  }
}

export async function generateRoleDocument(
  releaseDocument: string,
  role: Role
): Promise<string> {
  return generateRoleDocumentWithContext(releaseDocument, role);
}

export async function generateRoleDocumentWithContext(
  releaseDocument: string,
  role: Role
): Promise<string> {
  try {
    const roleContext = DEFAULT_ROLE_CONTEXTS[role];

    const prompt = `
${roleContext}

**Release Document:**
${releaseDocument}

**Task:** Create a role-specific document that extracts and highlights the information most relevant to this role. Format the response in HTML with proper headings and structure.
`;

    const systemPrompt = `
You are creating role-specific documentation for a ${role} team. Always respond in well-formatted HTML.
`;
    const { model } = chooseModel("role", systemPrompt, prompt, 0, role);

    const provider = getAIProvider(model);
    const content = await provider.generateCompletion(
      systemPrompt,
      prompt,
      model
    );

    return content || `Failed to generate ${role} document`;
  } catch (error) {
    console.error(`Error generating ${role} document:`, error);
    return `<p>Error generating ${role} document: ${error instanceof Error ? error.message : "Unknown error"}</p>`;
  }
}

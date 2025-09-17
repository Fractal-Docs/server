import { getAIProvider, ModelType } from "./ai-providers";

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
  diffAnalysis: string,
  model: ModelType
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

    const provider = getAIProvider(model);
    const content = await provider.generateCompletion(
      "You are a technical product manager creating release documentation. Always respond in well-formatted HTML.",
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
  role: string,
  model: ModelType
): Promise<string> {
  return generateRoleDocumentWithContext(releaseDocument, role, model);
}

export async function generateRoleDocumentWithContext(
  releaseDocument: string,
  role: string,
  model: ModelType
): Promise<string> {
  try {
    const roleContexts = {
      sales: `
You are analyzing a software release from a Sales perspective. Focus on:
- New features that can be sold to prospects
- Improvements that solve customer pain points
- Competitive advantages and differentiators
- ROI and business value propositions
- Customer-facing benefits and outcomes
- Demo-worthy features and capabilities

Create a document specifically for the sales team with talking points, customer benefits, and selling opportunities.
`,
      marketing: `
You are analyzing a software release from a Marketing perspective. Focus on:
- Features that can drive marketing campaigns
- User experience improvements worth promoting
- Market positioning and messaging opportunities
- Content marketing angles and stories
- Social media and PR-worthy announcements
- Brand differentiation opportunities

Create a document specifically for the marketing team with campaign ideas, messaging frameworks, and promotional angles.
`,
      "customer-success": `
You are analyzing a software release from a Customer Success perspective. Focus on:
- Features that improve customer onboarding
- User experience enhancements that reduce friction
- Support and self-service improvements
- Customer retention and engagement features
- Training and education implications
- Potential customer confusion or support burden

Create a document specifically for the customer success team with onboarding considerations, training needs, and customer communication templates.
`,
      csm: `
You are analyzing a software release from a Customer Success Manager perspective. Focus on:
- Knowledge base articles and in-app tooltips needed
- Release-day communication with current customers
- Success plan templates for new features
- Webinar and workshop deck content
- Customer feedback loops and early adoption tracking
- Risk register and rollback plan considerations

Create a document specifically for CSMs with customer communication templates, training materials, and success metrics.
`,
      revops: `
You are analyzing a software release from a Revenue Operations perspective. Focus on:
- Updated price books and SKU listings in CRM
- Forecast model adjustments with new capabilities
- Board-level revenue impact briefings
- Order-form templates and discount guardrails
- ARR pipeline updates from Sales team
- Contract and billing system constraints

Create a document specifically for RevOps with pricing updates, revenue forecasts, and operational considerations.
`,
      ps: `
You are analyzing a software release from a Professional Services perspective. Focus on:
- Updated implementation runbooks and templates
- Migration scripts and configuration templates
- Internal playbook for partners and contractors
- Risk register and rollback plan
- Post-go-live validation checklist
- Lessons-learned log for feedback to Product and Engineering

Create a document specifically for Professional Services with implementation guides, risk assessments, and validation procedures.
`,
    };

    const roleContext =
      roleContexts[role as keyof typeof roleContexts] || roleContexts.sales;

    const prompt = `
${roleContext}

**Release Document:**
${releaseDocument}

**Task:** Create a role-specific document that extracts and highlights the information most relevant to this role. Format the response in HTML with proper headings and structure.
`;

    const provider = getAIProvider(model);
    const content = await provider.generateCompletion(
      `You are creating role-specific documentation for a ${role} team. Always respond in well-formatted HTML.`,
      prompt,
      model
    );

    return content || `Failed to generate ${role} document`;
  } catch (error) {
    console.error(`Error generating ${role} document:`, error);
    return `<p>Error generating ${role} document: ${error instanceof Error ? error.message : "Unknown error"}</p>`;
  }
}

import type { Express } from "express";
import { db } from "src/db";
import { releases } from "src/shared/schema";
import { nanoid } from "nanoid";
import { storage } from "src/storage";
import { getAIProvider, type ModelType } from "../ai-providers";
import { analyzeDiff, generateRoleDocumentWithContext } from "../releases";

export function releaseRoutes(app: Express) {
  app.post("/api/releases", async (req, res) => {
    try {
      const { title, prd, repoId, branch, model = "gpt-4o" } = req.body;
      const diffAnalysis = await analyzeDiff(repoId, branch);

      const releaseDocument = await generateReleaseDocument(
        prd,
        diffAnalysis,
        model as ModelType
      );

      const salesDocument = await generateRoleDocument(
        releaseDocument,
        "sales",
        model as ModelType
      );
      const marketingDocument = await generateRoleDocument(
        releaseDocument,
        "marketing",
        model as ModelType
      );
      const customerSuccessDocument = await generateRoleDocument(
        releaseDocument,
        "customer-success",
        model as ModelType
      );

      const releaseId = nanoid();

      const newRelease = await storage.createRelease({
        releaseId,
        title,
        prd,
        repoId,
        branch,
        diffAnalysis,
        releaseDocument,
        salesDocument,
        marketingDocument,
        customerSuccessDocument,
      });

      res.json(newRelease);
    } catch (error) {
      console.error("Error creating release:", error);
      res.status(500).json({
        error:
          error instanceof Error ? error.message : "Failed to create release",
      });
    }
  });

  app.get("/api/releases", async (req, res) => {
    try {
      // need to get the releases for a users repos
      const allReleases = await db
        .select()
        .from(releases)
        .orderBy(releases.createdAt);
      res.json(allReleases);
    } catch (error) {
      console.error("Error fetching releases:", error);
      res.status(500).json({ error: "Failed to fetch releases" });
    }
  });

  app.get("/api/releases/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const release = await storage.getRelease(id);

      if (!release) {
        res.status(404).json({ error: "Release not found" });
      }

      res.json(release);
    } catch (error) {
      console.error("Error fetching release:", error);
      res.status(500).json({ error: "Failed to fetch release" });
    }
  });

  app.post("/api/releases/:id/generate-roles", async (req: any, res: any) => {
    try {
      const { id } = req.params;
      const { roles: selectedRoles } = req.body;

      const release = await storage.getRelease(id);

      if (!release) {
        return res.status(404).json({ error: "Release not found" });
      }

      const roleDocuments: Record<string, string> = {};

      for (const role of selectedRoles) {
        try {
          const document = await generateRoleDocumentWithContext(
            release.releaseDocument,
            role
          );
          roleDocuments[role] = document;
        } catch (error) {
          console.error(`Error generating document for role ${role}:`, error);
          roleDocuments[role] =
            `<p>Error generating ${role} document: ${error instanceof Error ? error.message : "Unknown error"}</p>`;
        }
      }

      const updateData: any = {
        roleDocuments: { ...(release.roleDocuments || {}), ...roleDocuments },
      };

      if (selectedRoles.includes("csm")) {
        updateData.csmDocument = roleDocuments.csm;
      }
      if (selectedRoles.includes("revops")) {
        updateData.revopsDocument = roleDocuments.revops;
      }
      if (selectedRoles.includes("ps")) {
        updateData.psDocument = roleDocuments.ps;
      }

      const updatedRelease = await storage.updateRelease(id, updateData);

      res.json(updatedRelease);
    } catch (error) {
      console.error("Error generating role documents:", error);
      res.status(500).json({
        error:
          error instanceof Error
            ? error.message
            : "Failed to generate role documents",
      });
    }
  });
}

async function generateReleaseDocument(
  prd: string,
  diffAnalysis: string,
  model: ModelType = "gpt-4o"
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

async function generateRoleDocument(
  releaseDocument: string,
  role: string,
  model: ModelType = "gpt-4o"
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

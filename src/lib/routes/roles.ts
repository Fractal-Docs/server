import type { Express } from "express";
import { z } from "zod";

const roleTemplateSchema = z.object({
  role: z.string().min(1),
  context: z.string().min(1),
});

export const AVAILABLE_ROLES = [
  {
    id: "sales",
    name: "Sales",
    description:
      "Focus on selling opportunities, customer benefits, and ROI propositions",
    icon: "TrendingUp",
    color: "blue",
  },
  {
    id: "marketing",
    name: "Marketing",
    description: "Campaign ideas, messaging frameworks, and promotional angles",
    icon: "Users",
    color: "purple",
  },
  {
    id: "customer-success",
    name: "Customer Success",
    description:
      "Onboarding considerations, training needs, and customer communication",
    icon: "Heart",
    color: "green",
  },
  {
    id: "csm",
    name: "Customer Success Manager",
    description:
      "Knowledge base articles, customer communication templates, and success metrics",
    icon: "UserCheck",
    color: "teal",
  },
  {
    id: "revops",
    name: "Revenue Operations",
    description:
      "Pricing updates, revenue forecasts, and operational considerations",
    icon: "DollarSign",
    color: "orange",
  },
  {
    id: "ps",
    name: "Professional Services",
    description:
      "Implementation guides, risk assessments, and validation procedures",
    icon: "Settings",
    color: "gray",
  },
];

export const DEFAULT_ROLE_CONTEXTS = {
  sales: `You are analyzing a software release from a Sales perspective. Focus on:
- New features that can be sold to prospects
- Improvements that solve customer pain points
- Competitive advantages and differentiators
- ROI and business value propositions
- Customer-facing benefits and outcomes
- Demo-worthy features and capabilities

Create a document specifically for the sales team with talking points, customer benefits, and selling opportunities.`,

  marketing: `You are analyzing a software release from a Marketing perspective. Focus on:
- Features that can drive marketing campaigns
- User experience improvements worth promoting
- Market positioning and messaging opportunities
- Content marketing angles and stories
- Social media and PR-worthy announcements
- Brand differentiation opportunities

Create a document specifically for the marketing team with campaign ideas, messaging frameworks, and promotional angles.`,

  "customer-success": `You are analyzing a software release from a Customer Success perspective. Focus on:
- Features that improve customer onboarding
- User experience enhancements that reduce friction
- Support and self-service improvements
- Customer retention and engagement features
- Training and education implications
- Potential customer confusion or support burden

Create a document specifically for the customer success team with onboarding considerations, training needs, and customer communication templates.`,

  csm: `You are analyzing a software release from a Customer Success Manager perspective. Focus on:
- Knowledge base articles and in-app tooltips needed
- Release-day communication with current customers
- Success plan templates for new features
- Webinar and workshop deck content
- Customer feedback loops and early adoption tracking
- Risk register and rollback plan considerations

Create a document specifically for CSMs with customer communication templates, training materials, and success metrics.`,

  revops: `You are analyzing a software release from a Revenue Operations perspective. Focus on:
- Updated price books and SKU listings in CRM
- Forecast model adjustments with new capabilities
- Board-level revenue impact briefings
- Order-form templates and discount guardrails
- ARR pipeline updates from Sales team
- Contract and billing system constraints

Create a document specifically for RevOps with pricing updates, revenue forecasts, and operational considerations.`,

  ps: `You are analyzing a software release from a Professional Services perspective. Focus on:
- Updated implementation runbooks and templates
- Migration scripts and configuration templates
- Internal playbook for partners and contractors
- Risk register and rollback plan
- Post-go-live validation checklist
- Lessons-learned log for feedback to Product and Engineering

Create a document specifically for Professional Services with implementation guides, risk assessments, and validation procedures.`,
};

export function roleRoutes(app: Express) {
  app.get("/api/roles", async (req, res) => {
    try {
      res.json(AVAILABLE_ROLES);
    } catch (error) {
      console.error("Error fetching roles:", error);
      res.status(500).json({ error: "Failed to fetch roles" });
    }
  });

  app.get("/api/roles/:roleId", async (req, res) => {
    try {
      const { roleId } = req.params;
      const role = AVAILABLE_ROLES.find((r) => r.id === roleId);

      if (!role) {
        return res.status(404).json({ error: "Role not found" });
      }

      const context =
        DEFAULT_ROLE_CONTEXTS[roleId as keyof typeof DEFAULT_ROLE_CONTEXTS];

      res.json({
        ...role,
        context,
        template: context,
      });
    } catch (error) {
      console.error("Error fetching role:", error);
      res.status(500).json({ error: "Failed to fetch role" });
    }
  });

  app.post("/api/roles/:roleId/template", async (req, res) => {
    try {
      const { roleId } = req.params;
      const { context } = roleTemplateSchema.parse(req.body);

      const role = AVAILABLE_ROLES.find((r) => r.id === roleId);
      if (!role) {
        return res.status(404).json({ error: "Role not found" });
      }

      res.json({
        success: true,
        message: "Template updated successfully",
        roleId,
        context,
      });
    } catch (error) {
      console.error("Error updating role template:", error);
      res.status(500).json({
        error:
          error instanceof Error ? error.message : "Failed to update template",
      });
    }
  });

  app.post("/api/roles/:roleId/revert", async (req, res) => {
    try {
      const { roleId } = req.params;
      const role = AVAILABLE_ROLES.find((r) => r.id === roleId);

      if (!role) {
        return res.status(404).json({ error: "Role not found" });
      }

      const defaultContext =
        DEFAULT_ROLE_CONTEXTS[roleId as keyof typeof DEFAULT_ROLE_CONTEXTS];

      res.json({
        success: true,
        message: "Template reverted to default",
        roleId,
        context: defaultContext,
      });
    } catch (error) {
      console.error("Error reverting role template:", error);
      res.status(500).json({ error: "Failed to revert template" });
    }
  });
}

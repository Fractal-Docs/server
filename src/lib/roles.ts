export type Role =
  | "sales"
  | "marketing"
  | "csm"
  | "revops"
  | "ps"
  | "executive"; // this role is specifically for high quality prose document

interface RoleDetails {
  id: Role;
  name: string;
  description: string;
  icon: string;
  color: string;
}

export const AVAILABLE_ROLES: RoleDetails[] = [
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

export const DEFAULT_ROLE_CONTEXTS: Record<Role, string> = {
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

  executive: `You are analyzing a software release from an Executive perspective. Focus on:
- Financial impact analysis
- Market positioning and competitive landscape
- Strategic alignment with business goals
- Long-term vision and roadmap planning
- Stakeholder engagement and communication
- Key performance indicators and metrics

Create a document specifically for Executives with financial analysis, market positioning, and strategic planning.`,
};

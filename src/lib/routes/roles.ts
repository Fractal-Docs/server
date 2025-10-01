import type { Express } from "express";
import { AVAILABLE_ROLES, DEFAULT_ROLE_CONTEXTS } from "src/lib/roles";

export function roleRoutes(app: Express) {
  app.get("/api/organization/:org_id/roles", async (req, res) => {
    try {
      res.json(AVAILABLE_ROLES);
    } catch (error) {
      console.error("Error fetching roles:", error);
      res.status(500).json({ error: "Failed to fetch roles" });
    }
  });

  app.get(
    "/api/organization/:org_id/roles/:roleId",
    async (req: any, res: any) => {
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
    }
  );

  app.post(
    "/api/organization/:org_id/roles/:roleId/revert",
    async (req: any, res: any) => {
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
    }
  );
}

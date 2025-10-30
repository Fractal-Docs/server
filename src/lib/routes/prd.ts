import type { Express } from "express"
import { insertPrdSchema } from "src/shared/schema"
import { storage } from "src/storage"
import { getParams } from "../helpers"

export function prdRoutes(app: Express) {
  // PRD routes
  app.get("/api/organization/:org_id/prds", async (req, res) => {
    try {
      const { org_id } = getParams(req, res, ["org_id"])
      const organization = await storage.getOrganization(org_id)
      if (!organization) {
        res.status(404).json({ error: "Organization not found" })
        return
      }
      const prds = await storage.getPrds(organization.id)
      res.json(prds)
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to fetch PRDs"
      res.status(500).json({ error: message })
    }
  })

  app.get("/api/organization/:org_id/prds/:prd_id", async (req, res) => {
    const { org_id, prd_id } = getParams(req, res, ["org_id", "prd_id"])
    const organization = await storage.getOrganization(org_id)
    if (!organization) {
      res.status(404).json({ error: "Organization not found" })
      return
    }

    const prd = await storage.getPrd(prd_id)
    if (!prd) {
      res.status(404).json({ error: "PRD not found" })
      return
    }

    res.json(prd)
  })

  app.get("/api/organization/:org_id/prds/search", async (req, res) => {
    try {
      const { org_id } = getParams(req, res, ["org_id"])
      const organization = await storage.getOrganization(org_id)
      if (!organization) {
        res.status(404).json({ error: "Organization not found" })
        return
      }
      const query = req.query.q as string
      const results = await storage.searchPrds(organization.id, query)
      res.json(results)
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Search failed"
      res.status(500).json({ error: message })
    }
  })

  app.post("/api/organization/:org_id/prds", async (req, res) => {
    try {
      const { org_id } = getParams(req, res, ["org_id"])
      const organization = await storage.getOrganization(org_id)
      if (!organization) {
        res.status(404).json({ error: "Organization not found" })
        return
      }
      const result = insertPrdSchema.safeParse(req.body)
      if (!result.success) {
        res.status(400).json({
          error: "Invalid PRD data",
          details: result.error.issues,
        })
        return
      }

      const prd = await storage.createPrd(result.data)
      res.json(prd)
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to create PRD"
      res.status(500).json({ error: message })
    }
  })

  app.delete("/api/organization/:org_id/prds/:prd_id", async (req, res) => {
    try {
      const { org_id, prd_id } = getParams(req, res, ["org_id", "prd_id"])
      const organization = await storage.getOrganization(org_id)
      if (!organization) {
        res.status(404).json({ error: "Organization not found" })
        return
      }

      await storage.deletePrd(prd_id)
      res.status(204).end()
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to delete PRD"
      res.status(500).json({ error: message })
    }
  })

  app.patch("/api/organization/:org_id/prds/:prd_id", async (req, res) => {
    try {
      const { org_id, prd_id } = getParams(req, res, ["org_id", "prd_id"])
      const organization = await storage.getOrganization(org_id)
      if (!organization) {
        res.status(404).json({ error: "Organization not found" })
        return
      }

      const result = insertPrdSchema.safeParse(req.body)
      if (!result.success) {
        res.status(400).json({
          error: "Invalid PRD data",
          details: result.error.issues,
        })
        return
      }

      const prd = await storage.updatePrd(prd_id, result.data)
      res.json(prd)
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to update PRD"
      res.status(500).json({ error: message })
    }
  })
}

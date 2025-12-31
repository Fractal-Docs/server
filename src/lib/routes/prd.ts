import type { Express } from "express"
import { insertPrdSchema } from "src/shared/schema"
import { storage } from "src/storage"
import {
  asyncHandler,
  withOrganization,
  OrganizationRequest,
} from "./middleware"

export function prdRoutes(app: Express) {
  // PRD routes - all routes use withOrganization middleware
  const orgMiddleware = withOrganization()

  app.get(
    "/api/organization/:org_id/prds",
    orgMiddleware,
    asyncHandler<OrganizationRequest>(async (req, res) => {
      const prds = await storage.getPrds(req.organization.id)
      res.json(prds)
    }, "Failed to fetch PRDs")
  )

  app.get(
    "/api/organization/:org_id/prds/search",
    orgMiddleware,
    asyncHandler<OrganizationRequest>(async (req, res) => {
      const query = req.query.q as string
      const results = await storage.searchPrds(req.organization.id, query)
      res.json(results)
    }, "Search failed")
  )

  app.get(
    "/api/organization/:org_id/prds/:prd_id",
    orgMiddleware,
    asyncHandler<OrganizationRequest>(async (req, res) => {
      const prdId = parseInt(req.params.prd_id)
      if (isNaN(prdId)) {
        res.status(400).json({ error: "Invalid PRD ID" })
        return
      }

      const prd = await storage.getPrd(prdId)
      if (!prd) {
        res.status(404).json({ error: "PRD not found" })
        return
      }

      res.json(prd)
    }, "Failed to fetch PRD")
  )

  app.post(
    "/api/organization/:org_id/prds",
    orgMiddleware,
    asyncHandler<OrganizationRequest>(async (req, res) => {
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
    }, "Failed to create PRD")
  )

  app.patch(
    "/api/organization/:org_id/prds/:prd_id",
    orgMiddleware,
    asyncHandler<OrganizationRequest>(async (req, res) => {
      const prdId = parseInt(req.params.prd_id)
      if (isNaN(prdId)) {
        res.status(400).json({ error: "Invalid PRD ID" })
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

      const prd = await storage.updatePrd(prdId, result.data)
      res.json(prd)
    }, "Failed to update PRD")
  )

  app.delete(
    "/api/organization/:org_id/prds/:prd_id",
    orgMiddleware,
    asyncHandler<OrganizationRequest>(async (req, res) => {
      const prdId = parseInt(req.params.prd_id)
      if (isNaN(prdId)) {
        res.status(400).json({ error: "Invalid PRD ID" })
        return
      }

      await storage.deletePrd(prdId)
      res.status(204).end()
    }, "Failed to delete PRD")
  )
}

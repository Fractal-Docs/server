import type { Express } from "express"
import { insertPrdSchema } from "src/shared/schema"
import { storage } from "src/storage"
import {
  requireOrgMember,
  requireOrgAdmin,
  authorizedHandler,
  verifyResourceOwnership,
  AuthorizedOrgRequest,
} from "./authorization"
import { hasValidPrefix } from "../public-ids"

export function prdRoutes(app: Express) {
  // Get all PRDs for organization - requires membership
  app.get(
    "/api/organization/:org_id/prds",
    ...requireOrgMember("org_id"),
    authorizedHandler<AuthorizedOrgRequest>(async (req, res) => {
      const prds = await storage.getPrds(req.orgId)

      // Return PRDs with publicId instead of internal id
      const sanitizedPrds = prds.map((prd) => ({
        publicId: prd.publicId,
        title: prd.title,
        content: prd.content,
        businessContext: prd.businessContext,
        repoPublicId: prd.repoPublicId,
        branch: prd.branch,
      }))

      res.json(sanitizedPrds)
    }, "Failed to fetch PRDs")
  )

  // Search PRDs - requires membership
  app.get(
    "/api/organization/:org_id/prds/search",
    ...requireOrgMember("org_id"),
    authorizedHandler<AuthorizedOrgRequest>(async (req, res) => {
      const query = req.query.q as string
      if (!query) {
        res.status(400).json({ error: "Search query is required" })
        return
      }

      const results = await storage.searchPrds(req.orgId, query)

      // Return PRDs with publicId instead of internal id
      const sanitizedResults = results.map((prd) => ({
        publicId: prd.publicId,
        title: prd.title,
        content: prd.content,
        businessContext: prd.businessContext,
        repoPublicId: prd.repoPublicId,
        branch: prd.branch,
      }))

      res.json(sanitizedResults)
    }, "Search failed")
  )

  // Get specific PRD - requires membership and validates PRD belongs to org
  app.get(
    "/api/organization/:org_id/prds/:prd_id",
    ...requireOrgMember("org_id"),
    authorizedHandler<AuthorizedOrgRequest>(async (req, res) => {
      const { prd_id } = req.params

      // Validate publicId format
      if (!hasValidPrefix(prd_id, "prd")) {
        res.status(400).json({
          error: "Invalid PRD ID format. Expected format: prd_xxxxxxxxxxxx",
        })
        return
      }

      const prd = await storage.getPrdByPublicId(prd_id)

      if (!prd) {
        res.status(404).json({ error: "PRD not found" })
        return
      }

      // Verify the PRD belongs to a repo in this organization
      const repo = await storage.getRepoByPublicId(prd.repoPublicId)
      if (!verifyResourceOwnership(repo, req, res, "PRD")) {
        return
      }

      // Return PRD with publicId
      res.json({
        publicId: prd.publicId,
        title: prd.title,
        content: prd.content,
        businessContext: prd.businessContext,
        repoPublicId: prd.repoPublicId,
        branch: prd.branch,
      })
    }, "Failed to fetch PRD")
  )

  // Create PRD - requires membership
  app.post(
    "/api/organization/:org_id/prds",
    ...requireOrgMember("org_id"),
    authorizedHandler<AuthorizedOrgRequest>(async (req, res) => {
      const result = insertPrdSchema.safeParse(req.body)
      if (!result.success) {
        res.status(400).json({
          error: "Invalid PRD data",
          details: result.error.issues,
        })
        return
      }

      // Verify the repo belongs to this organization
      const repo = await storage.getRepoByPublicId(result.data.repoPublicId)
      if (!verifyResourceOwnership(repo, req, res, "Repository")) {
        return
      }

      const prd = await storage.createPrd(result.data)

      // Return PRD with publicId
      res.json({
        publicId: prd.publicId,
        title: prd.title,
        content: prd.content,
        businessContext: prd.businessContext,
        repoPublicId: prd.repoPublicId,
        branch: prd.branch,
      })
    }, "Failed to create PRD")
  )

  // Update PRD - requires membership
  app.patch(
    "/api/organization/:org_id/prds/:prd_id",
    ...requireOrgMember("org_id"),
    authorizedHandler<AuthorizedOrgRequest>(async (req, res) => {
      const { prd_id } = req.params

      // Validate publicId format
      if (!hasValidPrefix(prd_id, "prd")) {
        res.status(400).json({
          error: "Invalid PRD ID format. Expected format: prd_xxxxxxxxxxxx",
        })
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

      const existingPrd = await storage.getPrdByPublicId(prd_id)

      if (!existingPrd) {
        res.status(404).json({ error: "PRD not found" })
        return
      }

      // Verify the existing PRD belongs to a repo in this organization
      const existingRepo = await storage.getRepoByPublicId(
        existingPrd.repoPublicId
      )
      if (!verifyResourceOwnership(existingRepo, req, res, "PRD")) {
        return
      }

      // If repoPublicId is being changed, verify the new repo also belongs to this org
      if (result.data.repoPublicId !== existingPrd.repoPublicId) {
        const newRepo = await storage.getRepoByPublicId(
          result.data.repoPublicId
        )
        if (!verifyResourceOwnership(newRepo, req, res, "Repository")) {
          return
        }
      }

      const prd = await storage.updatePrdByPublicId(prd_id, result.data)

      // Return PRD with publicId
      res.json({
        publicId: prd.publicId,
        title: prd.title,
        content: prd.content,
        businessContext: prd.businessContext,
        repoPublicId: prd.repoPublicId,
        branch: prd.branch,
      })
    }, "Failed to update PRD")
  )

  // Delete PRD - requires admin role
  app.delete(
    "/api/organization/:org_id/prds/:prd_id",
    ...requireOrgAdmin("org_id"),
    authorizedHandler<AuthorizedOrgRequest>(async (req, res) => {
      const { prd_id } = req.params

      // Validate publicId format
      if (!hasValidPrefix(prd_id, "prd")) {
        res.status(400).json({
          error: "Invalid PRD ID format. Expected format: prd_xxxxxxxxxxxx",
        })
        return
      }

      const existingPrd = await storage.getPrdByPublicId(prd_id)

      if (!existingPrd) {
        res.status(404).json({ error: "PRD not found" })
        return
      }

      // Verify the PRD belongs to a repo in this organization
      const repo = await storage.getRepoByPublicId(existingPrd.repoPublicId)
      if (!verifyResourceOwnership(repo, req, res, "PRD")) {
        return
      }

      await storage.deletePrdByPublicId(prd_id)

      res.status(204).end()
    }, "Failed to delete PRD")
  )
}

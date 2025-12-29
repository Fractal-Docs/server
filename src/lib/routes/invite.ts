import type { Express } from "express"
import { storage } from "src/storage"
import { getAuth0AccessToken, getUserByEmail } from "../auth0"

export function inviteRoutes(app: Express) {
  app.get("/api/invite/validate", async (req, res) => {
    try {
      const { token } = req.query

      if (!token || typeof token !== "string") {
        res.status(400).json({ error: "Token is required" })
        return
      }

      const invitation = await storage.getInvitationByToken(token)

      if (!invitation) {
        res.status(404).json({ error: "Invitation not found" })
        return
      }

      const organization = await storage.getOrganization(
        invitation.organizationId
      )

      if (!organization) {
        res.status(404).json({ error: "Organization not found" })
        return
      }

      const accessToken = await getAuth0AccessToken()
      const auth0User = await getUserByEmail(accessToken, invitation.email)

      res.json({
        invitation,
        user: auth0User,
        organization,
      })
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to validate invitation"
      res.status(500).json({ error: message })
    }
  })

  app.post("/api/invite/accept", async (req, res) => {
    try {
      const { token } = req.body

      if (!token || typeof token !== "string") {
        res.status(400).json({ error: "Token is required" })
        return
      }

      const invitation = await storage.getInvitationByToken(token)

      if (!invitation) {
        res.status(404).json({ error: "Invitation not found" })
        return
      }

      const organization = await storage.getOrganization(
        invitation.organizationId
      )

      if (!organization) {
        res.status(404).json({ error: "Organization not found" })
        return
      }

      await storage.acceptInvitation(invitation.token)

      res.json({ success: true })
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to accept invitation"
      res.status(500).json({ error: message })
    }
  })
}

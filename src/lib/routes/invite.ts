import type { Express } from "express"
import { storage } from "src/storage"
import { getAuth0AccessToken, getUserByEmail } from "../auth0"
import { asyncHandler, withUserSub, UserRequest } from "./middleware"

export function inviteUnprotectedRoutes(app: Express) {
  app.get(
    "/api/invite/validate",
    asyncHandler(async (req, res) => {
      const token = req.headers["x-invite-token"]

      if (!token || typeof token !== "string") {
        res.status(400).json({ error: "Token is required" })
        return
      }

      const invitation = await storage.getInvitationByToken(token)

      if (!invitation) {
        res.status(404).json({ error: "Invitation not found" })
        return
      }

      if (invitation.status === "rejected") {
        res
          .status(410)
          .json({ error: "Invitation has expired or been rejected" })
        return
      }

      if (invitation.status === "accepted") {
        res.status(200).json({
          message: "Invitation has already been accepted",
          invitationStatus: invitation.status,
        })
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
        userExists: !!auth0User,
        organization,
      })
    }, "Failed to validate invitation")
  )
}

export function inviteProtectedRoutes(app: Express) {
  const userMiddleware = withUserSub()

  app.post(
    "/api/invite/accept",
    userMiddleware,
    asyncHandler<UserRequest>(async (req, res) => {
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

      const accessToken = await getAuth0AccessToken()
      const auth0User = await getUserByEmail(accessToken, invitation.email)
      if (!auth0User) {
        res.status(400).json({ error: "User not found" })
        return
      }

      // Validate that the authenticated user matches the Auth0 user
      if (auth0User.user_id !== req.userSub) {
        res
          .status(403)
          .json({ error: "Authenticated user does not match invitation" })
        return
      }

      if (invitation.status === "rejected") {
        res
          .status(410)
          .json({ error: "Invitation has expired or been rejected" })
        return
      }

      if (invitation.status === "accepted") {
        res.status(409).json({ error: "Invitation has already been accepted" })
        return
      }

      const organization = await storage.getOrganization(
        invitation.organizationId
      )

      if (!organization) {
        res.status(404).json({ error: "Organization not found" })
        return
      }

      const user = await storage.getUser(auth0User.user_id)

      if (!user) {
        res.status(404).json({ error: "User not found" })
        return
      }

      await storage.acceptInvitation(invitation.token)
      await storage.addUserToOrganization({
        userId: user.id,
        organizationId: organization.id,
        role: "member",
      })

      res.json({ success: true })
    }, "Failed to accept invitation")
  )
}

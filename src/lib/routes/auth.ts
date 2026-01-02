import type { Express } from "express"

import { getAuth0AccessToken, getUserRoles } from "../auth0"
import { storage } from "src/storage"
import {
  requireAuth,
  authorizedHandler,
  AuthorizedRequest,
} from "./authorization"
import { withUserSub, asyncHandler, UserRequest } from "./middleware"

export function authRoutes(app: Express) {
  // Get current user - requires authentication
  app.get(
    "/api/user",
    requireAuth(),
    authorizedHandler<AuthorizedRequest>(async (req, res) => {
      // Return user with publicId instead of internal id
      const user = req.currentUser
      res.json({
        publicId: user.publicId,
        name: user.name,
        email: user.email,
        themePreferences: user.themePreferences,
      })
    }, "Failed to fetch user")
  )

  // Update current user - requires authentication
  app.patch(
    "/api/user",
    requireAuth(),
    authorizedHandler<AuthorizedRequest>(async (req, res) => {
      const user = await storage.updateUser({
        ...req.body,
        userSub: req.userSub,
      })
      // Return user with publicId instead of internal id
      res.json({
        publicId: user.publicId,
        name: user.name,
        email: user.email,
        themePreferences: user.themePreferences,
      })
    }, "Failed to update user")
  )

  // Create user - uses userSub from JWT (for initial registration)
  app.post(
    "/api/user",
    withUserSub(),
    asyncHandler<UserRequest>(async (req, res) => {
      const user = await storage.createUser({
        userSub: req.userSub,
        ...req.body,
      })
      // Return user with publicId instead of internal id
      res.json({
        publicId: user.publicId,
        name: user.name,
        email: user.email,
        themePreferences: user.themePreferences,
      })
    }, "Failed to create user")
  )

  // Get Auth0 roles - requires authentication
  app.get(
    "/api/auth/roles",
    requireAuth(),
    authorizedHandler<AuthorizedRequest>(async (req, res) => {
      const accessToken = await getAuth0AccessToken()
      const roles = await getUserRoles(accessToken, req.userSub)
      res.json(roles)
    }, "Failed to fetch roles")
  )
}

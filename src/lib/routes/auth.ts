import type { Express } from "express"

import { getAuth0AccessToken, getUserRoles } from "../auth0"
import { storage } from "src/storage"
import { asyncHandler, withUserSub, UserRequest } from "./middleware"

export function authRoutes(app: Express) {
  const userMiddleware = withUserSub()

  app.get(
    "/api/user",
    userMiddleware,
    asyncHandler<UserRequest>(async (req, res) => {
      const user = await storage.getUser(req.userSub)
      if (!user) {
        res.status(404).json({ error: "User not found" })
        return
      }
      res.json(user)
    }, "Failed to fetch user")
  )

  app.patch(
    "/api/user",
    userMiddleware,
    asyncHandler<UserRequest>(async (req, res) => {
      const user = await storage.updateUser({
        ...req.body,
        userSub: req.userSub,
      })
      res.json(user)
    }, "Failed to update user")
  )

  app.post(
    "/api/user",
    userMiddleware,
    asyncHandler<UserRequest>(async (req, res) => {
      const user = await storage.createUser({
        userSub: req.userSub,
        ...req.body,
      })
      res.json(user)
    }, "Failed to create user")
  )

  app.get(
    "/api/auth/roles",
    userMiddleware,
    asyncHandler<UserRequest>(async (req, res) => {
      const accessToken = await getAuth0AccessToken()
      const roles = await getUserRoles(accessToken, req.userSub)
      res.json(roles)
    }, "Failed to fetch roles")
  )
}

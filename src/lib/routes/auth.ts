import type { Express } from "express"

import { getAuth0AccessToken, getUserRoles } from "../auth0"
import { storage } from "src/storage"
import { getUserSub } from "../helpers"

export function authRoutes(app: Express) {
  app.get("/api/user", async (req, res) => {
    try {
      const userSub = getUserSub(req, res)
      if (!userSub) {
        return
      }
      const user = await storage.getUser(userSub)
      if (!user) {
        res.status(404).json({ error: "User not found" })
        return
      }
      res.json(user)
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to fetch user"
      res.status(500).json({ error: message })
    }
  })

  app.patch("/api/user", async (req, res) => {
    try {
      const userSub = getUserSub(req, res)
      if (!userSub) {
        return
      }
      const user = await storage.updateUser({ ...req.body, userSub })
      res.json(user)
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to update user"
      res.status(500).json({ error: message })
    }
  })

  app.post("/api/user", async (req, res) => {
    try {
      const userSub = getUserSub(req, res)
      if (!userSub) {
        return
      }
      const user = await storage.createUser({ userSub, ...req.body })
      res.json(user)
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to create user"
      res.status(500).json({ error: message })
    }
  })

  app.get("/api/auth/roles", async (req, res) => {
    try {
      const accessToken = await getAuth0AccessToken()
      const userSub = getUserSub(req, res)
      if (!userSub) {
        return
      }
      const roles = await getUserRoles(accessToken, userSub)
      res.json(roles)
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to fetch roles"
      res.status(500).json({ error: message })
    }
  })
}

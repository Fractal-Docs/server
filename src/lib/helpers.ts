import type { Request, Response } from "express"

/**
 * Extracts the user sub from the JWT token in the Authorization header
 * @param req - Express request object with auth property from express-oauth2-jwt-bearer
 * @param res - Express response object
 * @returns The user's sub identifier or undefined if not found
 */
export function getUserSub(req: Request, res: Response): string | undefined {
  // express-oauth2-jwt-bearer adds the decoded JWT payload to req.auth
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const auth = (req as any).auth

  if (!auth?.payload?.sub) {
    res.status(401).json({ error: "User not authenticated" })
    return undefined
  }

  return auth.payload.sub as string
}

export function getOrigin(req: Request, res: Response) {
  const origin = req.get("origin") || req.headers.host || ""
  let normalizedOrigin
  try {
    const url = new URL(
      origin.startsWith("http") ? origin : `https://${origin}`
    )
    normalizedOrigin = url.hostname + (url.port ? `:${url.port}` : "")
  } catch (error: unknown) {
    res.status(400).json({
      error,
    })
    return {
      origin,
      normalizedOrigin: "",
    }
  }
  return { origin, normalizedOrigin }
}

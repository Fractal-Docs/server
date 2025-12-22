type Params = "org_id" | "repo_id" | "prd_id" | "branch"

export function getParams(req, res, fieldsToReturn: Params[]) {
  const { org_id, repo_id, prd_id } = req.params
  // get branch from search params
  const branch = req.query.branch
  if (fieldsToReturn.includes("repo_id")) {
    if (repo_id === undefined || repo_id === null || repo_id === "") {
      res.status(400).json({ error: "Missing repository ID" })
      return {}
    }
    if (isNaN(Number(repo_id))) {
      res.status(400).json({ error: "Invalid repository ID" })
      return {}
    }
  }
  if (fieldsToReturn.includes("org_id")) {
    if (org_id === undefined || org_id === null || org_id === "") {
      res.status(404).json({ error: "Missing organization ID" })
      return {}
    }
    if (isNaN(Number(org_id))) {
      res.status(404).json({ error: "Invalid organization ID" })
      return {}
    }
  }
  if (fieldsToReturn.includes("prd_id")) {
    if (prd_id === undefined || prd_id === null || prd_id === "") {
      res.status(404).json({ error: "Missing PRD ID" })
      return {}
    }
    if (isNaN(Number(prd_id))) {
      res.status(404).json({ error: "Invalid PRD ID" })
      return {}
    }
  }

  return { org_id, repo_id, prd_id, branch: branch || "main" }
}

export function getOrigin(req, res) {
  const origin = req.get("origin") || req.headers.host || ""
  let normalizedOrigin
  try {
    const url = new URL(
      origin.startsWith("http") ? origin : `https://${origin}`
    )
    normalizedOrigin = url.hostname + (url.port ? `:${url.port}` : "")
  } catch (error: any) {
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

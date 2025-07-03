export function getParams(req, res) {
  const { id } = req.params;
  // get branch from search params
  const branch = req.query.branch;
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid repository ID" });
    return {};
  }

  return { id, branch: branch || "main" };
}

export function getOrigin(req, res) {
  const origin = req.get("origin") || req.headers.host || "";
  let normalizedOrigin;
  try {
    console.log("Origin:", origin);
    const url = new URL(
      origin.startsWith("http") ? origin : `https://${origin}`
    );
    normalizedOrigin = url.hostname + (url.port ? `:${url.port}` : "");
  } catch (error: any) {
    res.status(400).json({
      error,
    });
    return {
      origin,
      normalizedOrigin: "",
    };
  }
  return { origin, normalizedOrigin };
}

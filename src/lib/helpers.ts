export function getParams(req, res) {
  const { id } = req.params;
  // get branch from search params
  const branch = req.query.branch;
  console.log("Fetching parameters...", req);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid repository ID" });
    return {};
  }

  return { id, branch: branch || "main" };
}

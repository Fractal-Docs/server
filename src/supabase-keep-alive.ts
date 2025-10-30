// keep-alive.js
import cron from "node-cron"
import { Pool } from "@neondatabase/serverless"
import { drizzle } from "drizzle-orm/neon-serverless"
import * as schema from "./shared/schema"

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL environment variable is missing!")
  process.exit(1)
} else {
  console.log("Keep-alive module initialized")
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
})

export const db = drizzle({ client: pool, schema })

async function pingSupabase() {
  const client = await pool.connect()
  try {
    await client.query("SELECT NOW()")
    console.log(`[${new Date().toISOString()}] Keep-alive ping successful`)
  } catch (err: any) {
    console.error(
      `[${new Date().toISOString()}] Keep-alive ping failed:`,
      err.message
    )
  } finally {
    client.release()
  }
}

// Schedule: once a day at midnight
cron.schedule("0 0 * * *", async () => {
  await pingSupabase()
})

// Optional: Run once on startup
pingSupabase().catch((err) =>
  console.error("Initial keep-alive ping failed:", err.message)
)

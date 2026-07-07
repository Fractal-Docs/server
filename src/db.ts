import { Pool, neonConfig } from "@neondatabase/serverless"
import { drizzle } from "drizzle-orm/neon-serverless"
import ws from "ws"
import * as schema from "./shared/schema"
import dns from "dns"
import { promisify } from "util"

// Configure WebSocket for Neon connection
neonConfig.webSocketConstructor = ws

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set")
}

console.log("Initializing database connection...")

// Create a connection pool with proper error handling
const connectionConfig = {
  connectionString: process.env.DATABASE_URL,
  max: 20, // Maximum number of clients
  idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
  connectionTimeoutMillis: 5000, // Return an error after 5 seconds if connection could not be established
  ssl: {
    rejectUnauthorized: false, // Required for some PostgreSQL providers
  },
}

// Initialize the connection pool
export const pool = new Pool(connectionConfig)

// Add error handler for the pool
pool.on("error", (err) => {
  console.error("Unexpected error on idle client:", err.message)
})

// Create and export the Drizzle instance
export const db = drizzle({ client: pool, schema })

// Function to attempt connection with retries
const connectWithRetry = async (retries = 3, delay = 2000) => {
  const lookup = promisify(dns.lookup)
  const dbUrl = new URL(process.env.DATABASE_URL || "")

  // Test DNS resolution first
  try {
    await lookup(dbUrl.hostname)
  } catch (err: unknown) {
    console.error(
      "DNS resolution failed:",
      err instanceof Error ? err.message : err
    )
    throw new Error(`DNS resolution failed for ${dbUrl.hostname}`)
  }

  for (let i = 0; i < retries; i++) {
    try {
      const client = await pool.connect()
      try {
        await client.query("SELECT NOW()")
        console.log("Database connection established successfully")
        client.release()
        return true
      } catch (err) {
        client.release()
        throw err
      }
    } catch (err: unknown) {
      console.error(
        `Connection attempt ${i + 1} failed:`,
        err instanceof Error ? err.message : err
      )
      if (i < retries - 1) {
        console.log(`Retrying in ${delay / 1000} seconds...`)
        await new Promise((resolve) => setTimeout(resolve, delay))
        delay *= 2 // Exponential backoff
      } else {
        console.error("Failed to connect to database after retries:", err)
        throw err
      }
    }
  }
  return false
}

// Test the connection and verify schema on startup
connectWithRetry().catch((err) => {
  console.error("Failed to connect to database:", err)
  process.exit(1)
})

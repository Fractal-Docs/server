import { config } from "dotenv"
import { existsSync } from "fs"
import { resolve } from "path"

// Determine the current environment
export const NODE_ENV = process.env.NODE_ENV || "development"

// Load environment-specific configuration
function loadEnvironmentConfig() {
  const envFile = `.env.${NODE_ENV}`
  const envPath = resolve(process.cwd(), envFile)

  // Check if environment-specific file exists
  if (existsSync(envPath)) {
    config({ path: envPath })
    console.log(`Loaded environment config from ${envFile}`)
  } else {
    // Fall back to default .env file
    config()
    console.error(`Environment file ${envFile} not found, falling back to .env`)
  }
}

// Load the configuration
loadEnvironmentConfig()

// Export environment configuration
export const env = {
  NODE_ENV,
  PORT: process.env.PORT || "8888",
  DATABASE_URL: process.env.DATABASE_URL || "",
  GITHUB_CLIENT_ID: process.env.GITHUB_CLIENT_ID || "",
  GITHUB_CLIENT_SECRET: process.env.GITHUB_CLIENT_SECRET || "",
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || "",
  PINECONE_API_KEY: process.env.PINECONE_API_KEY || "",
  PINECONE_ENVIRONMENT: process.env.PINECONE_ENVIRONMENT || "",
  AUTH0_DOMAIN: process.env.AUTH0_DOMAIN || "",
  AUTH0_CLIENT_ID: process.env.AUTH0_CLIENT_ID || "",
  AUTH0_CLIENT_SECRET: process.env.AUTH0_CLIENT_SECRET || "",
  AUTH0_MGMT_CLIENT_ID: process.env.AUTH0_MGMT_CLIENT_ID || "",
  AUTH0_MGMT_CLIENT_SECRET: process.env.AUTH0_MGMT_CLIENT_SECRET || "",
  APP_BASE_URL: process.env.APP_BASE_URL || "",
  POSTMARK_API_KEY: process.env.POSTMARK_API_KEY || "",
} as const

// Helper functions
export const isDevelopment = () => NODE_ENV === "development"
export const isProduction = () => NODE_ENV === "production"
export const isTest = () => NODE_ENV === "test"

// Validate required environment variables
export function validateEnvironment() {
  // For testing role document generation, only require essential variables
  const requiredVars = ["DATABASE_URL", "OPENAI_API_KEY"]

  const missing = requiredVars.filter((varName) => !process.env[varName])

  if (missing.length > 0) {
    console.error("Missing required environment variables:")
    missing.forEach((varName) => console.error(`  - ${varName}`))
    process.exit(1)
  }

  console.log("All required environment variables are set")
}

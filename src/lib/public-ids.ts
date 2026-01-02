import { nanoid } from "nanoid"

/**
 * Public ID utilities for secure, non-enumerable external identifiers
 *
 * This module provides utilities for generating and working with public IDs
 * that are exposed to the frontend, preventing enumeration attacks on
 * sequential database IDs.
 */

const PUBLIC_ID_LENGTH = 12
/**
 * Generates a shorter public ID for user-facing contexts
 * @returns A URL-safe, unique identifier string (12 characters)
 */
export function generatePublicId(): string {
  return nanoid(PUBLIC_ID_LENGTH)
}

/**
 * Validates that a string looks like a valid public ID
 * Public IDs should be alphanumeric with underscores and hyphens
 * @param id - The string to validate
 * @param expectedLength - Optional expected length to validate against
 * @returns True if the string appears to be a valid public ID
 */
export function isValidPublicId(id: string, expectedLength?: number): boolean {
  if (!id || typeof id !== "string") {
    return false
  }

  // nanoid uses A-Za-z0-9_- characters
  const validPattern = /^[A-Za-z0-9_-]+$/

  if (!validPattern.test(id)) {
    return false
  }

  if (expectedLength !== undefined && id.length !== expectedLength) {
    return false
  }

  // Minimum reasonable length for a public ID
  if (id.length < 8) {
    return false
  }

  return true
}

/**
 * Type guard to check if a value is a numeric ID (internal) vs public ID
 * @param id - The ID to check
 * @returns True if the ID appears to be a numeric internal ID
 */
export function isNumericId(id: string | number): boolean {
  if (typeof id === "number") {
    return true
  }
  return /^\d+$/.test(id)
}

/**
 * Prefixed public ID generators for different entity types
 * These help with debugging and identifying ID types in logs
 */
export const publicIdGenerators = {
  organization: () => `org_${generatePublicId()}`,
  user: () => `usr_${generatePublicId()}`,
  prd: () => `prd_${generatePublicId()}`,
  repo: () => `repo_${generatePublicId()}`,
  release: () => `rel_${generatePublicId()}`,
  role: () => `role_${generatePublicId()}`,
} as const

/**
 * Extracts the prefix from a prefixed public ID
 * @param publicId - The public ID to extract prefix from
 * @returns The prefix (e.g., "org", "usr") or null if no prefix
 */
export function getPublicIdPrefix(publicId: string): string | null {
  const match = publicId.match(/^([a-z]+)_/)
  return match ? match[1] : null
}

/**
 * Validates a prefixed public ID has the expected prefix
 * @param publicId - The public ID to validate
 * @param expectedPrefix - The expected prefix (e.g., "org", "usr")
 * @returns True if the public ID has the expected prefix
 */
export function hasValidPrefix(
  publicId: string,
  expectedPrefix: string
): boolean {
  return publicId.startsWith(`${expectedPrefix}_`)
}

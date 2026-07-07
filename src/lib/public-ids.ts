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

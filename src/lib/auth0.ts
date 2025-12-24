import crypto from "crypto"

const AUTH0_DOMAIN = process.env.AUTH0_DOMAIN
const AUTH0_CLIENT_ID = process.env.AUTH0_CLIENT_ID
const AUTH0_CLIENT_SECRET = process.env.AUTH0_CLIENT_SECRET

function generateRandomPassword(length = 32) {
  return `!${crypto.randomBytes(length).toString("hex")}!`
}

/**
 * Function to get Auth0 Management API token
 * @returns {Promise<string>} - Returns a JWT token if authentication is successful
 */
export async function getAuth0AccessToken(): Promise<string> {
  try {
    const response = await fetch(`https://${AUTH0_DOMAIN}/oauth/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        grant_type: "client_credentials",
        audience: `https://${AUTH0_DOMAIN}/api/v2/`,
        client_id: AUTH0_CLIENT_ID,
        client_secret: AUTH0_CLIENT_SECRET,
      }),
    })

    if (!response.ok) {
      const errorData = await response.json()
      throw new Error(
        `Authentication failed: ${errorData.error_description || response.statusText}`
      )
    }

    const data = await response.json()
    return data.access_token
  } catch (error: any) {
    throw new Error(
      `Authentication failed: ${error.response?.data?.error_description || error.message}`
    )
  }
}

/**
 * Function to get roles for a user based on their Auth0 sub
 * @param {string} userSub - The user's Auth0 sub identifier
 * @returns {Promise<string[]>} - Returns an array of roles assigned to the user
 */
export async function getUserRoles(
  accessToken: string,
  userSub: string
): Promise<string[]> {
  try {
    const response = await fetch(
      `https://${AUTH0_DOMAIN}/api/v2/users/${userSub}/roles`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    )

    if (!response.ok) {
      const errorData = await response.json()
      throw new Error(
        `Failed to retrieve roles: ${errorData.error_description || response.statusText}`
      )
    }

    const data = await response.json()
    return data.map((role: { name: string }) => role.name)
  } catch (error: any) {
    throw new Error(
      `Failed to retrieve roles: ${error.response?.data?.error_description || error.message}`
    )
  }
}

/**
 * Function to create a user in Auth0
 * @param {string} email - The user's email address
 * @returns {Promise<string>} - Returns the user's Auth0 sub identifier
 */
export async function inviteUser(
  accessToken: string,
  email: string
): Promise<any> {
  try {
    const response = await fetch(`https://${AUTH0_DOMAIN}/api/v2/users`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email,
        email_verified: false,
        connection: "Username-Password-Authentication",
        password: generateRandomPassword(),
      }),
    })

    if (!response.ok) {
      const errorData = await response.json()
      console.log("error", errorData)
      throw new Error(errorData.error_description || response.statusText)
    }

    const data = await response.json()
    return data
  } catch (error: any) {
    throw new Error(error.response?.data?.error_description || error.message)
  }
}

export async function getUserByEmail(
  accessToken: string,
  email: string
): Promise<any> {
  try {
    const response = await fetch(
      `https://${AUTH0_DOMAIN}/api/v2/users-by-email?email=${encodeURIComponent(email)}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      }
    )

    if (!response.ok) {
      const errorData = await response.json()
      throw new Error(errorData.error_description || response.statusText)
    }

    const data = await response.json()
    const user = data.find((user: { email: string }) => user.email === email)
    if (!user) return undefined
    return user
  } catch (error: any) {
    throw new Error(error.response?.data?.error_description || error.message)
  }
}

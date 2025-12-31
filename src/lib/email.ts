import { ServerClient } from "postmark"

const apiKey = process.env.POSTMARK_API_KEY

if (!apiKey) {
  throw new Error("POSTMARK_API_KEY environment variable is not set")
}

const client = new ServerClient(apiKey)

function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  }
  return text.replace(/[&<>"']/g, (m) => map[m])
}

export const sendInviteEmail = async (email: string, inviteLink: string) => {
  const escapedLink = escapeHtml(inviteLink)
  const htmlBody = [
    "<p>You've been invited to join a workspace on Fractal.</p>",
    "<p>This invitation was sent to you because someone added your email address to their workspace on Fractal.</p>",
    `<p>To accept the invitation and access the workspace, click <a href="${escapedLink}">Join workspace</a>.</p>`,
    "<p>If you weren't expecting this invitation, you can safely ignore this email.</p>",
  ].join("\n")

  await client.sendEmail({
    From: "no-reply@usefractal.ai",
    To: email,
    Subject: "You've been invited to join Fractal",
    HtmlBody: htmlBody,
  })
}

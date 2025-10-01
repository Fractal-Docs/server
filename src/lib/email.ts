import { ServerClient } from "postmark";

const apiKey = process.env.POSTMARK_API_KEY;

const client = new ServerClient(apiKey || "");

export const sendInviteEmail = async (email: string, inviteLink: string) => {
  await client.sendEmail({
    From: "no-reply@usefractal.ai",
    To: email,
    Subject: "You’ve been invited",
    HtmlBody: `<p>Click <a href="${inviteLink}">here</a> to join</p>`,
  });
};

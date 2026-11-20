/**
 * One-time helper: obtains a Google OAuth refresh token for the fund sender account.
 * Usage:  npm run google:token
 * Needs GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env.local (Desktop-app OAuth client).
 * Opens a loopback server on http://127.0.0.1:53682, prints the consent URL, and
 * prints the refresh token once you approve. Paste it into .env.local as GOOGLE_REFRESH_TOKEN.
 */
import { config } from "dotenv";
import http from "node:http";
import { google } from "googleapis";
import { GOOGLE_SCOPES } from "../lib/google";

config({ path: ".env.local" });

const PORT = 53682;
const REDIRECT = `http://127.0.0.1:${PORT}/oauth2callback`;
const { GOOGLE_CLIENT_ID: id, GOOGLE_CLIENT_SECRET: secret } = process.env;
if (!id || !secret) {
  console.error("Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env.local first.");
  process.exit(1);
}

const client = new google.auth.OAuth2(id, secret, REDIRECT);
const url = client.generateAuthUrl({ access_type: "offline", prompt: "consent", scope: GOOGLE_SCOPES });

const server = http.createServer(async (req, res) => {
  if (!req.url?.startsWith("/oauth2callback")) return void res.end();
  const code = new URL(req.url, REDIRECT).searchParams.get("code");
  if (!code) return void res.end("No code in callback.");
  try {
    const { tokens } = await client.getToken(code);
    res.end("Done. You can close this tab and return to the terminal.");
    console.log("\nGOOGLE_REFRESH_TOKEN=" + (tokens.refresh_token ?? "(none returned; revoke access at myaccount.google.com/permissions and retry)"));
    console.log("Granted scopes:", tokens.scope);
  } catch (e) {
    res.end("Token exchange failed; see terminal.");
    console.error(e);
  } finally {
    server.close();
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log("Open this URL in a browser signed in as the FUND_SENDER_EMAIL account:\n\n" + url + "\n");
});

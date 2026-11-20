import { google } from "googleapis";

export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.readonly",
];

export function hasGoogleCreds() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REFRESH_TOKEN);
}

let _auth: InstanceType<typeof google.auth.OAuth2> | null = null;
export function googleAuth() {
  if (!hasGoogleCreds()) throw new Error("Google OAuth credentials missing");
  if (_auth) return _auth;
  _auth = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
  _auth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return _auth;
}

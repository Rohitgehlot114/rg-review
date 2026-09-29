import { randomBytes } from "node:crypto";

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function createReviewRequestToken(): string {
  return randomBytes(32).toString("base64url");
}

export function isReviewRequestToken(token: string): boolean {
  return TOKEN_PATTERN.test(token);
}

import * as crypto from "node:crypto";
import { createPasswordHash, extractBearerToken, getAdminState, hasConfiguredAdminPassword, verifyAdminToken, writeAdminState } from "../../lib/admin.js";
import { fail, ok, parseRequestBody } from "../../lib/http.js";

const MIN_PASSWORD_LENGTH = 8;

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") return fail(res, 405, "Method not allowed.");

  try {
    const token = extractBearerToken(req);
    const adminState = await getAdminState();
    if (!token || !verifyAdminToken(token, adminState.tokenSecret)) return fail(res, 401, "Unauthorized.");

    const body = parseRequestBody(req);
    const newPassword = typeof body.newPassword === "string" ? body.newPassword.trim() : "";
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      return fail(res, 400, `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
    }
    if (hasConfiguredAdminPassword()) {
      return fail(res, 409, "ADMIN_PASSWORD is set on the server and overrides panel changes. Update that variable instead.");
    }

    adminState.passwordHash = createPasswordHash(newPassword);
    adminState.tokenSecret = crypto.randomBytes(32).toString("hex");
    adminState.updatedAt = new Date().toISOString();
    await writeAdminState(adminState);
    return ok(res, { message: "Password updated." });
  } catch (error) {
    return fail(res, 500, error instanceof Error ? error.message : "Failed to update password.");
  }
}

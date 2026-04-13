import crypto from "crypto";
import {
  createPasswordHash,
  extractBearerToken,
  fail,
  getAdminState,
  ok,
  prepareAdminStateSchema,
  verifyAdminToken,
  writeAdminState,
} from "./shared";

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    return fail(res, 405, "Method not allowed.");
  }

  try {
    await prepareAdminStateSchema();

    const token = extractBearerToken(req);
    const adminState = await getAdminState();
    if (!token || !verifyAdminToken(token, adminState.tokenSecret)) {
      return fail(res, 401, "Unauthorized.");
    }

    const newPassword = typeof req.body?.newPassword === "string" ? req.body.newPassword.trim() : "";
    if (newPassword.length < 4) {
      return fail(res, 400, "Password must be at least 4 characters.");
    }

    adminState.passwordHash = createPasswordHash(newPassword);
    adminState.tokenSecret = crypto.randomBytes(32).toString("hex");
    adminState.updatedAt = new Date().toISOString();
    await writeAdminState(adminState);

    return ok(res, { message: "Password updated." });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update password.";
    return fail(res, 500, message);
  }
}

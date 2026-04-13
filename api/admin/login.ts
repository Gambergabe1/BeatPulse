import {
  createAdminToken,
  fail,
  getAdminState,
  ok,
  prepareAdminStateSchema,
  verifyPassword,
} from "./shared.ts";

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    return fail(res, 405, "Method not allowed.");
  }

  try {
    await prepareAdminStateSchema();
    const adminState = await getAdminState();

    const password = typeof req.body?.password === "string" ? req.body.password : "";
    if (!password) {
      return fail(res, 400, "Password is required.");
    }
    if (!verifyPassword(password, adminState.passwordHash)) {
      return fail(res, 401, "Invalid password.");
    }

    return ok(res, { token: createAdminToken(adminState.tokenSecret) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to process login.";
    return fail(res, 500, message);
  }
}

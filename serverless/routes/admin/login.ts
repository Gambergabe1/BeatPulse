import { hasConfiguredAdminPassword, loginAdmin } from "../../lib/admin.js";
import { fail, ok, parseRequestBody } from "../../lib/http.js";

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") return fail(res, 405, "Method not allowed.");

  try {
    const body = parseRequestBody(req);
    const password = typeof body.password === "string" ? body.password : "";
    if (!password) return fail(res, 400, "Password is required.");

    const token = await loginAdmin(password);
    if (!token) {
      return fail(res, 401, hasConfiguredAdminPassword()
        ? "Invalid password."
        : "Invalid password. If no admin password has been set yet, configure ADMIN_PASSWORD on the server.");
    }
    return ok(res, { token });
  } catch (error) {
    return fail(res, 500, error instanceof Error ? error.message : "Unable to process login.");
  }
}

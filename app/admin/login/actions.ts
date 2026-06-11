"use server";

import { redirect } from "next/navigation";
import { createAdminSession } from "../../../src/admin-auth";

export async function login(formData: FormData) {
  const password = String(formData.get("password") ?? "");
  if (!(await createAdminSession(password))) redirect("/admin/login?error=1");
  redirect("/admin");
}

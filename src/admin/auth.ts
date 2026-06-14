import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

const COOKIE_NAME = "njupt_admin";

/** 管理后台目前只有单管理员入口，因此用环境变量作为唯一凭据。 */
function adminPassword(): string {
  const value = process.env.ADMIN_PASSWORD;
  if (!value) throw new Error("ADMIN_PASSWORD is not configured");
  return value;
}

/**
 * Cookie 中不保存明文密码，只保存由管理密码派生出的 HMAC。
 *
 * 管理员修改 ADMIN_PASSWORD 后，旧 cookie 会自然失效；这里没有用户体系，
 * 所以不需要额外维护 session 表。
 */
function sessionValue(): string {
  return createHmac("sha256", adminPassword()).update("njupt-admin-session-v1").digest("hex");
}

/** timingSafeEqual 要求两侧 Buffer 等长，先判断长度可避免异常。 */
function equal(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** 判断当前请求是否已经通过后台登录。 */
export async function isAdmin(): Promise<boolean> {
  const value = (await cookies()).get(COOKIE_NAME)?.value;
  return Boolean(value && equal(value, sessionValue()));
}

/** 后台页面和 server action 的第一道保护，未登录时直接重定向。 */
export async function requireAdmin(): Promise<void> {
  if (!(await isAdmin())) redirect("/admin/login");
}

/** 校验密码并写入 httpOnly cookie，避免客户端脚本读取后台凭据。 */
export async function createAdminSession(password: string): Promise<boolean> {
  if (!equal(password, adminPassword())) return false;
  (await cookies()).set(COOKIE_NAME, sessionValue(), {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 7,
    path: "/",
  });
  return true;
}

/** 主动退出时清理后台 cookie。 */
export async function clearAdminSession(): Promise<void> {
  (await cookies()).delete(COOKIE_NAME);
}

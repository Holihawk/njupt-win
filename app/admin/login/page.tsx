import { redirect } from "next/navigation";
import { isAdmin } from "../../../src/admin/auth";
import { login } from "./actions";

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (await isAdmin()) redirect("/admin");
  const { error } = await searchParams;
  return (
    <main className="admin-login">
      <form action={login} className="admin-panel admin-form">
        <p className="eyebrow">管理后台</p>
        <h1>登录</h1>
        <label>
          管理密码
          <input name="password" required type="password" />
        </label>
        {error && <p className="form-error">密码不正确。</p>}
        <button type="submit">进入后台</button>
      </form>
    </main>
  );
}

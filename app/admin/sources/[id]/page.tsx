import Link from "next/link";
import { notFound } from "next/navigation";
import { SourceFields } from "../../../../components/admin-fields";
import { requireAdmin } from "../../../../src/admin-auth";
import { getAdminSource } from "../../../../src/admin-data";
import { updateSource } from "../../actions";

export default async function EditSourcePage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const source = await getAdminSource((await params).id);
  if (!source) notFound();
  return (
    <main className="admin-page">
      <section className="admin-panel">
        <Link href="/admin">← 返回后台</Link>
        <h1>编辑数据源</h1>
        <form action={updateSource} className="admin-form">
          <SourceFields source={source} />
          <button type="submit">保存修改</button>
        </form>
      </section>
    </main>
  );
}

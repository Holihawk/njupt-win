import Link from "next/link";
import { notFound } from "next/navigation";
import { DocumentFields } from "../../../../components/admin-fields";
import { requireAdmin } from "../../../../src/admin/auth";
import { getAdminDocument, listAdminSources } from "../../../../src/admin/data";
import { updateDocument } from "../../actions";

export default async function EditDocumentPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const id = Number((await params).id);
  const [document, sources] = await Promise.all([getAdminDocument(id), listAdminSources()]);
  if (!document) notFound();
  return (
    <main className="admin-page">
      <section className="admin-panel">
        <Link href="/admin">← 返回后台</Link>
        <h1>编辑文档</h1>
        <form action={updateDocument} className="admin-form">
          <DocumentFields document={document} sources={sources} />
          <button type="submit">保存修改</button>
        </form>
      </section>
    </main>
  );
}

import Link from "next/link";
import { ImportDraftFields } from "../../../components/admin-fields";
import { requireAdmin } from "../../../src/admin/auth";
import { importUrlDraft } from "../../../src/admin/import";
import { listAdminSources } from "../../../src/admin/data";
import { createImportedDocument } from "../actions";

export const dynamic = "force-dynamic";

export default async function ImportUrlPage({
  searchParams,
}: {
  searchParams: Promise<{ url?: string }>;
}) {
  await requireAdmin();
  const { url } = await searchParams;
  const sources = await listAdminSources();
  const draft = url ? await importUrlDraft(url, sources) : null;

  return (
    <main className="admin-page">
      <section className="admin-panel">
        <Link href="/admin">← 返回后台</Link>
        <p className="eyebrow">URL 自动解析</p>
        <h1>导入公开页面</h1>
        <p className="muted">
          自动解析会尽量提取文字、表格、图片和附件，但保存前仍需要人工删除导航噪音并修正说明。
        </p>
        <form className="admin-form" method="get">
          <label>
            页面 URL
            <input defaultValue={url ?? ""} name="url" required type="url" />
          </label>
          <button type="submit">解析预览</button>
        </form>
      </section>

      {draft && (
        <section className="admin-panel">
          <div className="section-heading">
            <h2>解析草稿</h2>
            <span>确认后写入数据库</span>
          </div>
          <form action={createImportedDocument} className="admin-form">
            <ImportDraftFields draft={draft} sources={sources} />
            <button type="submit">保存导入结果</button>
          </form>
        </section>
      )}
    </main>
  );
}

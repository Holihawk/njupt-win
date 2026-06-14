import Link from "next/link";
import { DocumentFields, SourceFields } from "../../components/admin-fields";
import { requireAdmin } from "../../src/admin/auth";
import { countAdminDocuments, listAdminDocuments, listAdminSources } from "../../src/admin/data";
import {
  archiveDocument,
  createDocument,
  createSource,
  logout,
  toggleSource,
} from "./actions";

export const dynamic = "force-dynamic";

const pageSize = 35;

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string | string[] }>;
}) {
  await requireAdmin();
  const rawPage = (await searchParams).page;
  const requestedPage = typeof rawPage === "string" ? Number(rawPage) : 1;
  const currentPage = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const [sources, totalDocuments] = await Promise.all([listAdminSources(), countAdminDocuments()]);
  const totalPages = Math.max(1, Math.ceil(totalDocuments / pageSize));
  const page = Math.min(currentPage, totalPages);
  const documents = await listAdminDocuments(pageSize, (page - 1) * pageSize);

  return (
    <main className="admin-page">
      <div className="admin-heading">
        <div>
          <p className="eyebrow">PostgreSQL 内容管理</p>
          <h1>数据后台</h1>
        </div>
        <div className="admin-heading-actions">
          <Link className="button-secondary" href="/admin/questions">提问历史</Link>
          <Link className="button-secondary" href="/admin/import">导入 URL</Link>
          <form action={logout}><button className="button-secondary" type="submit">退出</button></form>
        </div>
      </div>

      <section className="admin-panel">
        <div className="section-heading"><h2>数据源</h2><span>{sources.length} 个</span></div>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead><tr><th>名称</th><th>类型</th><th>权重</th><th>文档</th><th>状态</th><th>操作</th></tr></thead>
            <tbody>
              {sources.map((source) => (
                <tr key={source.id}>
                  <td><strong>{source.name}</strong><small>{source.id}</small></td>
                  <td>{source.sourceType}</td>
                  <td>{source.officialWeight}</td>
                  <td>{source.documentCount}</td>
                  <td>{source.enabled ? "启用" : "停用"}</td>
                  <td className="admin-actions">
                    <Link href={`/admin/sources/${source.id}`}>编辑</Link>
                    <form action={toggleSource}>
                      <input name="id" type="hidden" value={source.id} />
                      <button type="submit">{source.enabled ? "停用" : "启用"}</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <details>
          <summary>新增数据源</summary>
          <form action={createSource} className="admin-form">
            <SourceFields />
            <button type="submit">新增来源</button>
          </form>
        </details>
      </section>

      <section className="admin-panel">
        <div className="section-heading"><h2>全部文档</h2><span>共 {totalDocuments} 条，每页 {pageSize} 条</span></div>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead><tr><th>标题</th><th>来源</th><th>类型</th><th>日期</th><th>状态</th><th>操作</th></tr></thead>
            <tbody>
              {documents.map((document) => (
                <tr key={document.id}>
                  <td><strong>{document.title}</strong><small>{document.ingestionType}</small></td>
                  <td>{document.sourceName}</td>
                  <td>{document.documentType}</td>
                  <td>{document.publishedAt ?? "未知"}</td>
                  <td>{document.status}</td>
                  <td className="admin-actions">
                    <Link href={`/admin/documents/${document.id}`}>编辑</Link>
                    {document.status !== "archived" && (
                      <form action={archiveDocument}>
                        <input name="id" type="hidden" value={document.id} />
                        <button type="submit">归档</button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <nav className="pagination" aria-label="文档分页">
          <Link aria-disabled={page === 1} href={`/admin?page=${Math.max(1, page - 1)}`}>上一页</Link>
          <span>第 {page} / {totalPages} 页</span>
          <Link aria-disabled={page === totalPages} href={`/admin?page=${Math.min(totalPages, page + 1)}`}>下一页</Link>
        </nav>
        <details>
          <summary>手动新增文档</summary>
          <form action={createDocument} className="admin-form">
            <DocumentFields sources={sources} />
            <button type="submit">新增文档</button>
          </form>
        </details>
      </section>
    </main>
  );
}

import Link from "next/link";
import { requireAdmin } from "../../../src/admin-auth";
import { countAdminQuestionHistory, listAdminQuestionHistory } from "../../../src/admin-data";

export const dynamic = "force-dynamic";

const pageSize = 35;

export default async function AdminQuestionsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string | string[] }>;
}) {
  await requireAdmin();
  const rawPage = (await searchParams).page;
  const requestedPage = typeof rawPage === "string" ? Number(rawPage) : 1;
  const currentPage = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const total = await countAdminQuestionHistory();
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(currentPage, totalPages);
  const histories = await listAdminQuestionHistory(pageSize, (page - 1) * pageSize);

  return (
    <main className="admin-page">
      <div className="admin-heading">
        <div>
          <p className="eyebrow">RAG 使用记录</p>
          <h1>用户提问历史</h1>
        </div>
        <Link className="button-secondary" href="/admin">返回数据后台</Link>
      </div>

      <section className="admin-panel">
        <div className="section-heading">
          <h2>全部提问</h2>
          <span>共 {total} 条，每页 {pageSize} 条</span>
        </div>
        {histories.length === 0 ? (
          <p className="empty">还没有用户提问记录。</p>
        ) : (
          <div className="question-history-list">
            {histories.map((history) => (
              <article className="question-history-card" key={history.id}>
                <div className="question-history-meta">
                  <span className={`question-status question-status-${history.status}`}>
                    {statusLabel(history.status)}
                  </span>
                  <time dateTime={history.createdAt}>{formatDate(history.createdAt)}</time>
                  <span>{history.sourceCount} 个来源</span>
                </div>
                <h3>{history.question}</h3>
                <details>
                  <summary>查看回答与来源</summary>
                  <div className="question-history-answer">
                    {history.answer || history.error || "尚未生成回答"}
                  </div>
                  {history.sources.length > 0 && (
                    <div className="question-history-sources">
                      {history.sources.map((source, index) => (
                        <a href={source.url} key={`${source.url}-${index}`} rel="noreferrer" target="_blank">
                          {source.title}<small>{source.sourceName}</small>
                        </a>
                      ))}
                    </div>
                  )}
                </details>
              </article>
            ))}
          </div>
        )}
        <nav className="pagination" aria-label="提问历史分页">
          <Link aria-disabled={page === 1} href={`/admin/questions?page=${Math.max(1, page - 1)}`}>上一页</Link>
          <span>第 {page} / {totalPages} 页</span>
          <Link aria-disabled={page === totalPages} href={`/admin/questions?page=${Math.min(totalPages, page + 1)}`}>下一页</Link>
        </nav>
      </section>
    </main>
  );
}

function statusLabel(status: "pending" | "completed" | "stopped" | "failed"): string {
  return { pending: "生成中", completed: "已完成", stopped: "已停止", failed: "失败" }[status];
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "medium",
    timeZone: "Asia/Shanghai",
  }).format(new Date(value));
}

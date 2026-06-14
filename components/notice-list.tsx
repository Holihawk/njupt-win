import type { Notice } from "../src/content/notices";
import { safePublicUrl } from "../src/security/safe-url";

/** 统一渲染通知结果列表，所有条目保留官方原文跳转 */
export function NoticeList({ notices }: { notices: Notice[] }) {
  if (notices.length === 0) {
    return <p className="empty">暂无符合条件的通知</p>;
  }

  return (
    <div className="notice-list">
      {notices.map((notice) => (
        <article className="notice-card" key={notice.url}>
          <div className="notice-meta">
            <span>{notice.sourceName}</span>
            <time dateTime={notice.publishedAt ?? undefined}>{notice.publishedAt}</time>
          </div>
          <h3>{notice.title}</h3>
          {safePublicUrl(notice.url) && <a href={safePublicUrl(notice.url)!} rel="noreferrer" target="_blank">
            查看原文 <span aria-hidden="true">↗</span>
          </a>}
        </article>
      ))}
    </div>
  );
}

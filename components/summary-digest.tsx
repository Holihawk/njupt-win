import { getNoticeCategoryMeta, type NoticeSummary } from "../src/summary/summaries";
import { safePublicUrl } from "../src/security/safe-url";

/** 展示首页最新四条摘要 */
export function SummaryDigest({ summaries }: { summaries: NoticeSummary[] }) {
  if (summaries.length === 0) return null;

  return (
    <section className="summary-panel">
      <div className="summary-heading">
        <div>
          <p className="eyebrow">公开信息查看</p>
          <h1>通知摘要</h1>
        </div>
        <span>AI 摘要，请以原文为准</span>
      </div>
      <ol className="summary-list">
        {summaries.map((summary) => {
          const tag = getNoticeCategoryMeta(summary.category);
          const url = safePublicUrl(summary.documentUrl);
          if (!url) return null;
          return (
          <li className={`summary-tag-${tag.tone}`} key={summary.documentUrl}>
            <a href={url} rel="noreferrer" target="_blank">
              <strong>{tag.label}</strong>
              <span>{brief(summary.summary)}</span>
              <small>↗</small>
            </a>
          </li>
          );
        })}
      </ol>
    </section>
  );
}

/** 限制页面文本长度，兼容历史摘要文件或人工修改内容 */
function brief(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  const firstSentence = normalized.match(/^.*?[。！？；]/)?.[0] ?? normalized;
  return firstSentence.length > 50 ? `${firstSentence.slice(0, 49)}…` : firstSentence;
}

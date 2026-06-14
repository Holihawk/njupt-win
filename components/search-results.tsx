import type { HybridSearchResult } from "../src/search/hybrid-search";
import { safePublicUrl } from "../src/security/safe-url";

export function SearchResults({ results }: { results: HybridSearchResult[] }) {
  if (results.length === 0) return <p className="empty">暂无符合条件的内容</p>;

  return (
    <div className="smart-results">
      {results.map((result) => {
        const resultUrl = safePublicUrl(result.url);
        return (
        <article className="smart-result-card" key={result.documentId}>
          <div className="notice-meta">
            <span>{result.sourceName} · {blockLabel(result.blockType)}</span>
            <time dateTime={result.publishedAt ?? undefined}>{result.publishedAt ?? "长期内容"}</time>
          </div>
          <h3>{result.title}</h3>
          <p>{result.snippet}</p>
          {result.evidences.length > 0 && (
            <div className="evidence-list">
              {result.evidences.map((evidence, index) => {
                const evidenceUrl = safePublicUrl(evidence.assetUrl) ?? resultUrl;
                if (!evidenceUrl) return null;
                return (
                <a
                  className={`evidence-chip evidence-${evidence.type}`}
                  href={evidenceUrl}
                  key={`${evidence.type}-${index}`}
                  rel="noreferrer"
                  target="_blank"
                >
                  {evidence.type === "image" && safePublicUrl(evidence.assetUrl) && (
                    <img alt="" src={safePublicUrl(evidence.assetUrl)!} />
                  )}
                  <span>
                    <strong>{evidence.title}</strong>
                    {evidence.description && <small>{evidence.description}</small>}
                  </span>
                </a>
                );
              })}
            </div>
          )}
          {resultUrl && <a href={resultUrl} rel="noreferrer" target="_blank">
            查看原文 <span aria-hidden="true">↗</span>
          </a>}
        </article>
        );
      })}
    </div>
  );
}

function blockLabel(type: string): string {
  const labels: Record<string, string> = {
    heading: "标题",
    text: "正文",
    table: "表格",
    manual_note: "人工备注",
    attachment_text: "附件解析文本",
  };
  return labels[type] ?? type;
}

import { SearchForm } from "../../components/search-form";
import { SearchResults } from "../../components/search-results";
import { hybridSearch } from "../../src/search/hybrid-search";

export const dynamic = "force-dynamic";

/** 纯搜索页：执行混合检索并直接展示来源，不调用 LLM 生成答案 */
export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const params = await searchParams;
  const query = typeof params.q === "string" ? params.q.trim().slice(0, 300) : "";
  const results = query ? await hybridSearch(query, 8) : [];

  return (
    <main className="search-page">
      <p className="eyebrow">混合检索</p>
      <h1>搜索</h1>
      <p className="muted">混合检索标题、正文、表格和附件解析文本；图片和附件会作为证据展示</p>
      <SearchForm defaultValue={query} />
      <section className="search-results">
        <div className="section-heading">
          <h2>{query ? `“${query}” 的搜索结果` : "输入关键词开始搜索"}</h2>
          {query && <span>{results.length} 条</span>}
        </div>
        {query && <SearchResults results={results} />}
      </section>
    </main>
  );
}

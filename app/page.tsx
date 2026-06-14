import { CalendarCard } from "../components/calendar-card";
import { NoticeList } from "../components/notice-list";
import { RagChat } from "../components/rag-chat";
import { SummaryDigest } from "../components/summary-digest";
import { getCalendarStatus, loadCalendarConfig } from "../src/content/calendar";
import { loadDocuments, recentNotices } from "../src/content/notices";
import { hasLlmConfig, loadSummaries, selectRecentSummaries } from "../src/summary/summaries";
import { hasRagConfig } from "../src/rag/index";

export const dynamic = "force-dynamic";

/**
 * 首页服务端组件
 *
 * 并行加载通知、校历和摘要，随后只把页面所需的近期数据交给展示组件
 */
export default async function Home() {
  const summariesEnabled = hasLlmConfig();
  const [documents, calendarConfig, summaries] = await Promise.all([
    loadDocuments(),
    loadCalendarConfig(),
    summariesEnabled ? loadSummaries() : Promise.resolve([]),
  ]);
  const notices = recentNotices(documents, new Date(), 14, 5);
  const recentSummaries = selectRecentSummaries(summaries, documents, new Date(), 14, 4);
  const calendar = getCalendarStatus(calendarConfig.terms, new Date(), calendarConfig.events);

  return (
    <main>
      <RagChat enabled={hasRagConfig()} />
      <div className={`top-dashboard${recentSummaries.length === 0 ? " top-dashboard-calendar-only" : ""}`}>
        <SummaryDigest summaries={recentSummaries} />
        <CalendarCard status={calendar} />
      </div>
      <section className="notice-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">过去 2 周</p>
            <h2>最近通知</h2>
          </div>
          <span>最多展示 5 条</span>
        </div>
        <NoticeList notices={notices} />
      </section>
    </main>
  );
}

/** 数据源标识由数据库维护；解析器当前只对部分 source id 有专用规则。 */
export type SourceId = string;

/** 抓取一个公开通知列表所需的最小配置。 */
export type SourceConfig = {
  id: SourceId;
  name: string;
  baseUrl: string;
  listUrl: string;
};

/** 通知详情页中发现的附件元数据；阶段三仍不下载或解析附件正文。 */
export type Attachment = {
  title: string;
  url: string;
  fileType: string | null;
};

/** 列表页解析后的中间结构，用于决定继续抓详情页还是直接保存附件。 */
export type ListItem = {
  sourceId: SourceId;
  title: string;
  url: string;
  publishedAt: string | null;
  itemType: "page" | "attachment";
};

/**
 * 抓取后的统一文档模型。
 *
 * hash 只反映影响下游处理的内容字段，用于判断摘要和向量化是否需要重新执行。
 */
export type Document = {
  sourceId: SourceId;
  sourceName: string;
  title: string;
  url: string;
  publishedAt: string | null;
  author: string | null;
  content: string;
  contentHtml: string | null;
  attachments: Attachment[];
  itemType: "page" | "attachment";
  hash: string;
  fetchedAt: string;
  status: "active" | "failed";
  error?: string;
};

/** 单次抓取任务的汇总统计，便于定时任务监控和问题排查。 */
export type CrawlReport = {
  startedAt: string;
  finishedAt: string;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  archived?: number;
  sources: Record<
    string,
    { listed: number; pages: number; attachments: number; error?: string }
  >;
};

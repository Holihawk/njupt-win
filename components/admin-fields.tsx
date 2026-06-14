import type { AdminDocument, AdminSource } from "../src/admin/data";
import type { EditableBlock, ImportedDraft } from "../src/admin/import";
import { BlockEditor } from "./block-editor";

export function SourceFields({ source }: { source?: AdminSource }) {
  return (
    <div className="admin-form-grid">
      <label>
        来源 ID
        <input defaultValue={source?.id} name="id" readOnly={Boolean(source)} required />
      </label>
      <label>
        显示名称
        <input defaultValue={source?.name} name="name" required />
      </label>
      <label>
        站点地址
        <input defaultValue={source?.baseUrl} name="baseUrl" required type="url" />
      </label>
      <label>
        栏目列表地址
        <input defaultValue={source?.listUrl ?? ""} name="listUrl" type="url" />
      </label>
      <label>
        来源类型
        <select defaultValue={source?.sourceType ?? "notice"} name="sourceType">
          <option value="notice">通知站</option>
          <option value="content">内容站</option>
          <option value="service">服务入口</option>
        </select>
      </label>
      <label>
        解析器
        <input defaultValue={source?.parserType ?? "webplus"} name="parserType" required />
      </label>
      <label>
        官方权重
        <input
          defaultValue={source?.officialWeight ?? "1.00"}
          max="5"
          min="0"
          name="officialWeight"
          required
          step="0.05"
          type="number"
        />
      </label>
      <label className="admin-check">
        <input defaultChecked={source?.autoCrawl ?? false} name="autoCrawl" type="checkbox" />
        自动抓取
      </label>
      <label className="admin-check">
        <input defaultChecked={source?.enabled ?? true} name="enabled" type="checkbox" />
        启用来源
      </label>
      <label className="admin-wide">
        备注
        <textarea defaultValue={source?.notes ?? ""} name="notes" rows={3} />
      </label>
    </div>
  );
}

export function DocumentFields({
  document,
  sources,
  blocks,
}: {
  document?: AdminDocument;
  sources: AdminSource[];
  blocks?: EditableBlock[];
}) {
  const editableBlocks = blocks ?? document?.blocks ?? [];
  return (
    <>
      <div className="admin-form-grid">
        {document && <input name="id" type="hidden" value={document.id} />}
        <DocumentMetaFields document={document} sources={sources} />
      </div>
      <BlockEditor initialBlocks={editableBlocks} />
    </>
  );
}

export function ImportDraftFields({ draft, sources }: { draft: ImportedDraft; sources: AdminSource[] }) {
  return (
    <>
      <div className="admin-form-grid">
        <DocumentMetaFields document={draft} sources={sources} />
      </div>
      <BlockEditor initialBlocks={draft.blocks} />
    </>
  );
}

/**
 * 文档元数据表单复用于手工新增、编辑和 URL 导入草稿
 *
 * blocks 只负责结构化内容；这里的 content 是兼容旧搜索/摘要逻辑的聚合正文
 */
function DocumentMetaFields({
  document,
  sources,
}: {
  document?: Partial<AdminDocument | ImportedDraft>;
  sources: AdminSource[];
}) {
  const status = document && "status" in document ? document.status ?? "active" : "active";
  const expiresAt = document && "expiresAt" in document ? document.expiresAt ?? "" : "";
  const pinned = document && "pinned" in document ? Boolean(document.pinned) : false;
  return (
    <>
      <label>
        数据源
        <select defaultValue={document?.sourceId ?? ""} name="sourceId">
          <option value="">无关联来源</option>
          {sources.map((source) => (
            <option key={source.id} value={source.id}>{source.name}</option>
          ))}
        </select>
      </label>
      <label>
        来源显示名称
        <input defaultValue={document?.sourceName} name="sourceName" required />
      </label>
      <label className="admin-wide">
        标题
        <input defaultValue={document?.title} name="title" required />
      </label>
      <label className="admin-wide">
        原文地址
        <input defaultValue={document?.url} name="url" required type="url" />
      </label>
      <label>
        发布时间
        <input defaultValue={document?.publishedAt ?? ""} name="publishedAt" type="date" />
      </label>
      <label>
        发布者
        <input defaultValue={document?.author ?? ""} name="author" />
      </label>
      <label>
        文档类型
        <select defaultValue={document?.documentType ?? "manual"} name="documentType">
          <option value="notice">通知</option>
          <option value="guide">办事指南</option>
          <option value="faq">常见问题</option>
          <option value="news">新闻</option>
          <option value="manual">人工知识</option>
        </select>
      </label>
      <label>
        状态
        <select defaultValue={status} name="status">
          <option value="active">有效</option>
          <option value="archived">归档</option>
          <option value="failed">失败</option>
        </select>
      </label>
      <label>
        过期日期
        <input defaultValue={expiresAt} name="expiresAt" type="date" />
      </label>
      <label className="admin-check">
        <input defaultChecked={pinned} name="pinned" type="checkbox" />
        人工置顶
      </label>
      <label className="admin-wide">
        聚合正文
        <textarea defaultValue={document?.content} name="content" required rows={8} />
      </label>
    </>
  );
}

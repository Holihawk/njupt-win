"use client";

import { useMemo, useState } from "react";
import type { EditableBlock, EditableBlockType } from "../src/admin-import";

type UiBlock = Omit<EditableBlock, "metadata"> & {
  id: string;
  metadata: string;
};

const blockTypes: { value: EditableBlockType; label: string }[] = [
  { value: "heading", label: "标题" },
  { value: "text", label: "文字" },
  { value: "table", label: "表格" },
  { value: "image", label: "图片" },
  { value: "attachment", label: "附件" },
  { value: "attachment_text", label: "附件解析文本" },
  { value: "html", label: "HTML" },
  { value: "manual_note", label: "人工备注" },
];

/**
 * 后台内容块编辑器
 *
 * 这里使用客户端状态只负责“新增/删除 block”这种纯表单交互
 * 真正的保存仍由父级 form 提交到 server action，保证数据库写入逻辑集中在服务端
 */
export function BlockEditor({ initialBlocks }: { initialBlocks: EditableBlock[] }) {
  const initial = useMemo(() => normalizeInitialBlocks(initialBlocks), [initialBlocks]);
  const [blocks, setBlocks] = useState<UiBlock[]>(initial);
  const [newType, setNewType] = useState<EditableBlockType>("manual_note");

  function updateBlock(index: number, patch: Partial<UiBlock>) {
    setBlocks((current) =>
      current.map((block, candidateIndex) =>
        candidateIndex === index ? { ...block, ...patch } : block,
      ),
    );
  }

  function deleteBlock(index: number) {
    setBlocks((current) => current.filter((_, candidateIndex) => candidateIndex !== index));
  }

  function moveBlock(index: number, direction: -1 | 1) {
    setBlocks((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function addBlock() {
    setBlocks((current) => [...current, blankBlock(newType)]);
  }

  return (
    <section className="block-editor">
      <div className="section-heading">
        <h2>内容块</h2>
        <span>{blocks.length} 个，保存后按当前顺序入库</span>
      </div>
      <input name="blockCount" type="hidden" value={blocks.length} />
      {blocks.map((block, index) => (
        <fieldset className="block-card" key={block.id}>
          <div className="block-card-heading">
            <legend>Block {index + 1}</legend>
            <div className="block-card-actions">
              <button className="button-secondary" disabled={index === 0} onClick={() => moveBlock(index, -1)} type="button">
                上移
              </button>
              <button className="button-secondary" disabled={index === blocks.length - 1} onClick={() => moveBlock(index, 1)} type="button">
                下移
              </button>
              <button className="button-danger" onClick={() => deleteBlock(index)} type="button">
                删除 block
              </button>
            </div>
          </div>
          <div className="admin-form-grid">
            <label>
              类型
              <select
                name={`block.${index}.type`}
                onChange={(event) => updateBlock(index, { type: event.target.value as EditableBlockType })}
                value={block.type}
              >
                {blockTypes.map((type) => (
                  <option key={type.value} value={type.value}>{type.label}</option>
                ))}
              </select>
            </label>
            <label>
              标题/说明
              <input
                name={`block.${index}.title`}
                onChange={(event) => updateBlock(index, { title: event.target.value })}
                value={block.title}
              />
            </label>
            <label className="admin-wide">
              图片或附件 URL
              <input
                name={`block.${index}.assetUrl`}
                onChange={(event) => updateBlock(index, { assetUrl: event.target.value })}
                type="url"
                value={block.assetUrl}
              />
            </label>
            <label className="admin-wide">
              内容
              <textarea
                name={`block.${index}.content`}
                onChange={(event) => updateBlock(index, { content: event.target.value })}
                rows={block.type === "table" ? 8 : 5}
                value={block.content}
              />
            </label>
            <label className="admin-wide">
              HTML 片段
              <textarea
                name={`block.${index}.html`}
                onChange={(event) => updateBlock(index, { html: event.target.value })}
                rows={3}
                value={block.html}
              />
            </label>
            <label className="admin-wide">
              元数据 JSON
              <textarea
                name={`block.${index}.metadata`}
                onChange={(event) => updateBlock(index, { metadata: event.target.value })}
                rows={3}
                value={block.metadata}
              />
            </label>
            <label className="admin-check">
              <input
                checked={block.enabled}
                name={`block.${index}.enabled`}
                onChange={(event) => updateBlock(index, { enabled: event.target.checked })}
                type="checkbox"
              />
              启用
            </label>
            <label className="admin-check">
              <input
                checked={block.evidenceEnabled}
                name={`block.${index}.evidenceEnabled`}
                onChange={(event) => updateBlock(index, { evidenceEnabled: event.target.checked })}
                type="checkbox"
              />
              可作为 AI 证据展示
            </label>
            <label>
              证据标题
              <input
                name={`block.${index}.evidenceTitle`}
                onChange={(event) => updateBlock(index, { evidenceTitle: event.target.value })}
                value={block.evidenceTitle}
              />
            </label>
            <label className="admin-wide">
              证据说明
              <textarea
                name={`block.${index}.evidenceDescription`}
                onChange={(event) => updateBlock(index, { evidenceDescription: event.target.value })}
                rows={3}
                value={block.evidenceDescription}
              />
            </label>
          </div>
        </fieldset>
      ))}
      <div className="block-add-row">
        <label>
          新增 block 类型
          <select onChange={(event) => setNewType(event.target.value as EditableBlockType)} value={newType}>
            {blockTypes.map((type) => (
              <option key={type.value} value={type.value}>{type.label}</option>
            ))}
          </select>
        </label>
        <button className="button-secondary" onClick={addBlock} type="button">添加 block</button>
      </div>
    </section>
  );
}

/** 把服务端 block 转为 UI 状态，metadata 用字符串保留，便于管理员直接编辑 JSON */
function normalizeInitialBlocks(blocks: EditableBlock[]): UiBlock[] {
  const source = blocks.length > 0 ? blocks : [blankEditableBlock("text")];
  return source.map((block, index) => ({
    ...block,
    id: `${index}-${block.type}-${crypto.randomUUID()}`,
    metadata: JSON.stringify(block.metadata ?? {}, null, 2),
  }));
}

function blankBlock(type: EditableBlockType): UiBlock {
  const block = blankEditableBlock(type);
  return {
    ...block,
    id: crypto.randomUUID(),
    metadata: "{}",
  };
}

function blankEditableBlock(type: EditableBlockType): EditableBlock {
  return {
    type,
    title: "",
    content: "",
    html: "",
    assetUrl: "",
    enabled: true,
    evidenceEnabled: type === "image" || type === "attachment",
    evidenceTitle: "",
    evidenceDescription: "",
    metadata: {},
  };
}

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Document } from "../types.js";

/**
 * 阶段一/二使用的轻量 JSON 文档存储。
 *
 * 通过 URL 构建 Map，实现与未来数据库唯一 URL 约束相同的去重语义。
 */
export class JsonDocumentStore {
  constructor(private readonly path: string) {}

  /** 加载文档并按 URL 建立索引；首次运行没有文件时返回空 Map。 */
  async load(): Promise<Map<string, Document>> {
    try {
      const value = JSON.parse(await readFile(this.path, "utf8")) as Document[];
      return new Map(value.map((document) => [document.url, document]));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Map();
      throw error;
    }
  }

  /** 按发布日期倒序保存，方便人工查看，也使生成文件更稳定。 */
  async save(documents: Map<string, Document>): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const sorted = [...documents.values()].sort((a, b) =>
      (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""),
    );
    await writeFile(this.path, `${JSON.stringify(sorted, null, 2)}\n`);
  }
}

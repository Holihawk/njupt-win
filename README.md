# njupt.win

njupt.win 是一个面向南京邮电大学公开信息的检索与 RAG 问答平台。

项目聚合分散在学校网站及社区指南中的公开内容，为用户提供校园信息搜索和带来源依据的
智能问答。

> 本项目及其部署站点不是南京邮电大学官方平台。回答仅供参考，重要事项请以学校官方
> 通知为准。

## 技术栈

- Next.js、React、TypeScript
- PostgreSQL、pgvector
- OpenAI-compatible Chat Completions 与 Embeddings API
- Vitest

## 贡献

欢迎通过 Issue 报告问题或提交 Pull Request。

提交代码前请运行：

```bash
npm run typecheck
npm test
npm run build
```

## 许可证

MIT

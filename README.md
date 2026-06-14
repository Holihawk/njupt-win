# njupt.win

njupt.win 是一个面向南京邮电大学公开信息的检索与 RAG 问答平台。

项目聚合分散在学校网站及社区指南中的公开内容，为用户提供校园信息搜索、带来源依据的
RAG 问答，以及无需校园资料检索的日常问答。

问答页支持自动、校园资料和通用问答模式切换，并在浏览器中保存最多 12 个匿名会话。
用户可以恢复、删除、重新生成、复制回答或提交有用性反馈；删除会话会同步删除服务端对应
的匿名问题记录。

生产安全方面，问答 API 会校验同源请求、JSON 大小和消息顺序；匿名会话凭据仅以摘要
保存。检索资料和历史消息会作为不可信数据传入模型，外链仅允许 HTTP(S) 与站内路径。
全站同时启用 CSP、禁止 iframe 嵌入、MIME 防嗅探和最小浏览器权限策略。

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

更新代码后需要先执行数据库迁移：

```bash
npm run db:migrate
```

## 许可证

MIT

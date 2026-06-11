export default function AboutPage() {
  return (
    <main className="about-page">
      <header className="about-intro">
        <p className="eyebrow">About njupt.win</p>
        <h1>一站式校园信息查询</h1>
        <p className="about-lead">面向南京邮电大学公开信息的检索与 RAG 问答平台</p>
        <p className="muted">
          njupt.win 将分散在学校官网、本科生院及社区指南中的公开内容统一入库，通过
          PostgreSQL、pgvector、混合检索和大语言模型，为用户提供带原文、图片及附件
          依据的校园信息问答。
        </p>
      </header>

      <aside className="about-notice">
        <strong>重要说明</strong>
        <p>
          本项目及其部署站点不是南京邮电大学官方平台，回答仅供参考，重要事项请以引用
          的官方原文和学校最新通知为准。
        </p>
      </aside>

      <section className="about-features">
        <p className="eyebrow">Features</p>
        <h2>功能特性</h2>
        <h3>用户端</h3>
        <ul>
          <li>基于已入库资料的 RAG 问答，支持流式输出、停止生成和连续追问</li>
          <li>综合标题、正文、发布时间、来源权重与向量召回的混合检索</li>
          <li>回答附带可核验的原文、图片和附件依据</li>
          <li>不调用 LLM 的纯搜索页面</li>
          <li>最近通知、结构化摘要、学期进度和个人日程提醒</li>
          <li>对资料库未覆盖的问题拒绝编造</li>
        </ul>
      </section>

      <div className="about-contact">
        有好的改进建议或新的想法？欢迎联系
        <a href="mailto:H@yeji.edu.kg">H@yeji.edu.kg</a>
      </div>
    </main>
  );
}

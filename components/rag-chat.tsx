"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { RiSendPlaneFill, RiSendPlaneLine, RiStopCircleFill, RiStopCircleLine } from "react-icons/ri";
import type { HybridSearchResult } from "../src/hybrid-search";
import type { RagMessage } from "../src/rag";
import { SearchResults } from "./search-results";

type TurnStatus = "winning" | "winned" | "stopped";

type AnswerTurn = {
  question: string;
  answer: string;
  sources: HybridSearchResult[];
  status: TurnStatus;
};

type StreamEvent =
  | { type: "sources"; sources: HybridSearchResult[] }
  | { type: "delta"; content: string }
  | { type: "done" }
  | { type: "error"; error: string };

/**
 * 首页只展示提问入口；带 initialQuestion 时进入独立问答模式并立即开始流式回答
 * 对话仅保留在当前页面内，Stop 会通过 AbortController 真正取消正在读取的响应流
 */
export function RagChat({ enabled, initialQuestion = "" }: { enabled: boolean; initialQuestion?: string }) {
  const router = useRouter();
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<RagMessage[]>([]);
  const [turns, setTurns] = useState<AnswerTurn[]>([]);
  const [pending, setPending] = useState(false);
  const [navigating, setNavigating] = useState(false);
  const [error, setError] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const startedRef = useRef(false);
  const standalone = Boolean(initialQuestion);

  useEffect(() => {
    if (!initialQuestion || startedRef.current) return;
    startedRef.current = true;
    void ask(initialQuestion, []);
  }, [initialQuestion]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const question = input.trim();
    if (!question || pending || !enabled) return;
    if (!standalone) {
      setNavigating(true);
      await animateToAskPage(event.currentTarget, () => router.push(`/ask?q=${encodeURIComponent(question)}`));
      return;
    }
    setInput("");
    await ask(question, messages);
  }

  async function ask(question: string, history: RagMessage[]) {
    const nextMessages: RagMessage[] = [...history, { role: "user", content: question }];
    const turnIndex = turns.length;
    setTurns((current) => [...current, { question, answer: "", sources: [], status: "winning" }]);
    setPending(true);
    setError("");
    const controller = new AbortController();
    abortRef.current = controller;
    let completedAnswer = "";

    try {
      const response = await fetch("/api/rag", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: nextMessages }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        const payload = await response.json() as { error?: string };
        throw new Error(payload.error || "问答请求失败");
      }

      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        buffer += value ?? "";
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? "";
        for (const line of lines.filter(Boolean)) {
          const event = JSON.parse(line) as StreamEvent;
          if (event.type === "sources") updateTurn(turnIndex, { sources: event.sources });
          if (event.type === "delta") {
            completedAnswer += event.content;
            updateTurn(turnIndex, { answer: completedAnswer });
          }
          if (event.type === "error") throw new Error(event.error);
          if (event.type === "done") updateTurn(turnIndex, { status: "winned" });
        }
        if (done) break;
      }
      setMessages([...nextMessages, { role: "assistant", content: completedAnswer }]);
    } catch (reason) {
      if ((reason as Error).name === "AbortError") {
        updateTurn(turnIndex, { status: "stopped" });
        setMessages([...nextMessages, { role: "assistant", content: completedAnswer || "回答已停止。" }]);
      } else {
        updateTurn(turnIndex, { status: "stopped" });
        setError((reason as Error).message);
      }
    } finally {
      abortRef.current = null;
      setPending(false);
    }
  }

  function updateTurn(index: number, patch: Partial<AnswerTurn>) {
    setTurns((current) => current.map((turn, turnIndex) => turnIndex === index ? { ...turn, ...patch } : turn));
  }

  function stop() {
    abortRef.current?.abort();
  }

  return (
    <section className={`rag-panel${standalone ? " rag-workspace" : " rag-entry"}`}>
      {!enabled && <p className="form-error">LLM API 尚未配置，暂时无法生成回答</p>}
      {error && <p className="form-error">{error}</p>}

      {standalone && (
        <div className="rag-conversation">
          {turns.map((turn, index) => (
            <article className="rag-exchange" key={`${turn.question}-${index}`}>
              <div className="rag-user-row">
                <p>{turn.question}</p>
              </div>
              <div className="rag-assistant-row">
                <div className={`rag-status rag-status-${turn.status}`}>
                  <span>{turn.status}</span>
                  {turn.status === "winning" && (
                    <span aria-hidden="true" className="rag-thinking-dots">
                      <i /><i /><i />
                    </span>
                  )}
                </div>
                <StreamingAnswer answer={turn.answer} status={turn.status} />
                <RagEvidence sources={turn.sources} />
                {turn.sources.length > 0 && <SourcesAccordion sources={turn.sources} />}
              </div>
            </article>
          ))}
        </div>
      )}

      <form className="search-form rag-form" onSubmit={submit}>
        <label className="sr-only" htmlFor="rag-question">向校园资料库提问</label>
        <input
          disabled={!enabled || navigating}
          id="rag-question"
          onChange={(event) => setInput(event.target.value)}
          placeholder={standalone ? "继续追问…" : "询问任何校园信息"}
          value={input}
        />
        {pending ? (
          <button aria-label="停止生成" className="rag-icon-button rag-stop-button" onClick={stop} type="button">
            <IconSwap fill={<RiStopCircleFill />} line={<RiStopCircleLine />} />
          </button>
        ) : (
          <button
            aria-label={standalone ? "追问" : "提问"}
            className="rag-icon-button"
            disabled={!enabled || navigating}
            type="submit"
          >
            <IconSwap fill={<RiSendPlaneFill />} line={<RiSendPlaneLine />} />
          </button>
        )}
      </form>
    </section>
  );
}

/** 将模型返回的流式片段缓冲为稳定的逐字显示，避免较大数据块突然跳入页面。 */
function StreamingAnswer({ answer, status }: { answer: string; status: TurnStatus }) {
  const [displayed, setDisplayed] = useState("");

  useEffect(() => {
    if (displayed.length >= answer.length) return;
    const remaining = answer.length - displayed.length;
    const step = Math.max(1, Math.ceil(remaining / 14));
    const timer = window.setTimeout(() => {
      setDisplayed(answer.slice(0, Math.min(answer.length, displayed.length + step)));
    }, 22);
    return () => window.clearTimeout(timer);
  }, [answer, displayed]);

  const streaming = status === "winning" || displayed.length < answer.length;
  const content = displayed || (status === "winning" ? "正在检索并组织回答…" : "未生成回答。");
  return <div className={`rag-answer${streaming ? " rag-answer-streaming" : ""}`}>{content}</div>;
}

/** 来源始终保留在 DOM 中，通过网格行高实现可逆的平滑展开。 */
function SourcesAccordion({ sources }: { sources: HybridSearchResult[] }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="rag-sources">
      <button aria-expanded={open} onClick={() => setOpen((value) => !value)} type="button">
        查看来源
      </button>
      <div aria-hidden={!open} className="rag-sources-reveal" data-open={open} inert={!open}>
        <div>
          <SearchResults results={sources} />
        </div>
      </div>
    </section>
  );
}

function IconSwap({ fill, line }: { fill: React.ReactNode; line: React.ReactNode }) {
  return (
    <span aria-hidden="true" className="icon-swap">
      <span className="icon-line">{line}</span>
      <span className="icon-fill">{fill}</span>
    </span>
  );
}

/** 首页提交时使用克隆节点执行 FLIP，衔接到问答页底部的同形输入框。 */
async function animateToAskPage(form: HTMLFormElement, navigate: () => void) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    navigate();
    return;
  }

  const rect = form.getBoundingClientRect();
  const targetWidth = Math.min(760, window.innerWidth - 22);
  const targetLeft = (window.innerWidth - targetWidth) / 2;
  const targetTop = window.innerHeight - rect.height - 14;
  const clone = form.cloneNode(true) as HTMLFormElement;
  clone.removeAttribute("id");
  clone.querySelectorAll("[id]").forEach((element) => element.removeAttribute("id"));
  clone.setAttribute("aria-hidden", "true");
  clone.inert = true;
  clone.classList.add("rag-form-transition-clone");
  Object.assign(clone.style, {
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
  });
  document.body.append(clone);
  form.classList.add("rag-form-leaving");
  document.documentElement.classList.add("rag-route-leaving");

  const scaleX = targetWidth / rect.width;
  try {
    await clone.animate(
      [
        { transform: "translate3d(0, 0, 0) scaleX(1)", borderRadius: "18px" },
        {
          transform: `translate3d(${targetLeft - rect.left}px, ${targetTop - rect.top}px, 0) scaleX(${scaleX})`,
          borderRadius: "15px",
        },
      ],
      { duration: 440, easing: "cubic-bezier(.2, .8, .2, 1)", fill: "forwards" },
    ).finished;
  } catch {
    // 浏览器取消动画时仍继续进入问答页，避免导航被视觉增强阻断。
  }

  navigate();
  window.setTimeout(() => {
    clone.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 180, fill: "forwards" }).finished
      .finally(() => clone.remove());
    document.documentElement.classList.remove("rag-route-leaving");
  }, 280);
}

/** 服务端按当前问题筛选证据，并简洁展示 */
function RagEvidence({ sources }: { sources: HybridSearchResult[] }) {
  const images = sources.flatMap((source) =>
    source.evidences.filter((evidence) => evidence.type === "image" && evidence.assetUrl),
  );
  const attachments = sources.flatMap((source) =>
    source.evidences.filter((evidence) => evidence.type === "attachment" && evidence.assetUrl),
  );
  if (images.length === 0 && attachments.length === 0) return null;
  return (
    <section className="rag-evidence">
      {images.length > 0 && (
        <div className="rag-image-gallery">
          {images.map((image, index) => (
            <a href={image.assetUrl!} key={`${image.assetUrl}-${index}`} rel="noreferrer" target="_blank">
              <img alt={image.title} src={image.assetUrl!} />
              <span>{image.title}</span>
            </a>
          ))}
        </div>
      )}
      {attachments.length > 0 && (
        <div className="rag-attachment-list">
          {attachments.map((attachment, index) => (
            <a href={attachment.assetUrl!} key={`${attachment.assetUrl}-${index}`} rel="noreferrer" target="_blank">
              {attachment.title}
            </a>
          ))}
        </div>
      )}
    </section>
  );
}

"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  RiCheckLine,
  RiDeleteBinLine,
  RiFileCopyLine,
  RiHistoryLine,
  RiRefreshLine,
  RiSendPlaneFill,
  RiSendPlaneLine,
  RiStopCircleFill,
  RiStopCircleLine,
  RiThumbDownFill,
  RiThumbDownLine,
  RiThumbUpFill,
  RiThumbUpLine,
} from "react-icons/ri";
import type { HybridSearchResult } from "../src/search/hybrid-search";
import type { RagMessage, RagRouteMode } from "../src/rag/index";
import { safePublicUrl } from "../src/security/safe-url";
import { SearchResults } from "./search-results";

type TurnStatus = "winning" | "winned" | "stopped";
type TurnFeedback = "helpful" | "unhelpful";

type AnswerTurn = {
  question: string;
  answer: string;
  sources: HybridSearchResult[];
  status: TurnStatus;
  mode?: RagRouteMode;
  historyId?: number;
  feedback?: TurnFeedback;
};

type StreamEvent =
  | { type: "meta"; historyId: number; mode: RagRouteMode }
  | { type: "sources"; sources: HybridSearchResult[] }
  | { type: "delta"; content: string }
  | { type: "done" }
  | { type: "error"; error: string };

/**
 * 首页只展示提问入口；带 initialQuestion 时进入独立问答模式并立即开始流式回答
 * 问答页会在浏览器保存匿名会话，Stop 会通过 AbortController 真正取消正在读取的响应流
 */
export function RagChat({
  enabled,
  initialQuestion = "",
  workspace = false,
}: {
  enabled: boolean;
  initialQuestion?: string;
  workspace?: boolean;
}) {
  const router = useRouter();
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<RagMessage[]>([]);
  const [turns, setTurns] = useState<AnswerTurn[]>([]);
  const [pending, setPending] = useState(false);
  const [navigating, setNavigating] = useState(false);
  const [sessionId, setSessionId] = useState("");
  const [restored, setRestored] = useState(false);
  const [conversationQuestion, setConversationQuestion] = useState(initialQuestion);
  const [conversationHistory, setConversationHistory] = useState<SavedConversation[]>([]);
  const [copiedTurn, setCopiedTurn] = useState<number | null>(null);
  const [error, setError] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const startedRef = useRef(false);
  const standalone = workspace || Boolean(initialQuestion);

  useEffect(() => {
    if (!standalone) return;
    const savedConversations = readConversations();
    const saved = savedConversations.find((conversation) => conversation.initialQuestion === initialQuestion);
    setConversationHistory(savedConversations);
    if (saved) {
      setSessionId(saved.sessionId);
      setMessages(saved.messages);
      setTurns(saved.turns.map((turn) => turn.status === "winning" ? { ...turn, status: "stopped" } : turn));
      setConversationQuestion(saved.initialQuestion);
      startedRef.current = true;
    } else {
      setSessionId(createSessionId());
      setConversationQuestion(initialQuestion);
    }
    setRestored(true);
  }, [initialQuestion, standalone]);

  useEffect(() => {
    if (!initialQuestion || !restored || startedRef.current || !sessionId) return;
    startedRef.current = true;
    void ask(initialQuestion, []);
  }, [initialQuestion, restored, sessionId]);

  useEffect(() => {
    if (!standalone || !restored || !sessionId || turns.length === 0) return;
    const timer = window.setTimeout(() => {
      const saved = writeConversation({
        initialQuestion: conversationQuestion,
        sessionId,
        messages,
        turns,
        updatedAt: Date.now(),
      });
      setConversationHistory(saved);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [conversationQuestion, messages, restored, sessionId, standalone, turns]);

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
    if (turns.length === 0) {
      setConversationQuestion(question);
      replaceAskUrl(question);
    }
    await ask(question, messages);
  }

  async function ask(question: string, history: RagMessage[], replaceFrom?: number) {
    const nextMessages: RagMessage[] = [...history, { role: "user", content: question }];
    const turnIndex = replaceFrom ?? turns.length;
    setTurns((current) => [
      ...current.slice(0, turnIndex),
      { question, answer: "", sources: [], status: "winning" },
    ]);
    setPending(true);
    setError("");
    const controller = new AbortController();
    abortRef.current = controller;
    let completedAnswer = "";

    try {
      const response = await fetch("/api/rag", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: nextMessages, sessionId }),
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
          if (event.type === "meta") updateTurn(turnIndex, { historyId: event.historyId, mode: event.mode });
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

  async function copyAnswer(answer: string, index: number) {
    await navigator.clipboard.writeText(answer);
    setCopiedTurn(index);
    window.setTimeout(() => setCopiedTurn((current) => current === index ? null : current), 1500);
  }

  async function regenerate(index: number) {
    if (pending) return;
    const history = turns.slice(0, index).flatMap<RagMessage>((turn) => [
      { role: "user", content: turn.question },
      { role: "assistant", content: turn.answer || "回答已停止" },
    ]);
    setMessages(history);
    await ask(turns[index].question, history, index);
  }

  async function sendFeedback(index: number, feedback: TurnFeedback) {
    const turn = turns[index];
    if (!turn.historyId || !sessionId) return;
    const response = await fetch("/api/rag/feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ historyId: turn.historyId, sessionId, feedback }),
    });
    if (!response.ok) {
      const payload = await response.json() as { error?: string };
      setError(payload.error || "反馈提交失败");
      return;
    }
    updateTurn(index, { feedback });
  }

  function loadConversation(conversation: SavedConversation) {
    if (pending || conversation.sessionId === sessionId) return;
    setConversationQuestion(conversation.initialQuestion);
    setSessionId(conversation.sessionId);
    setMessages(conversation.messages);
    setTurns(conversation.turns.map((turn) => turn.status === "winning" ? { ...turn, status: "stopped" } : turn));
    setError("");
    replaceAskUrl(conversation.initialQuestion);
  }

  async function deleteConversation(conversation: SavedConversation) {
    const saved = removeConversation(conversation.sessionId);
    setConversationHistory(saved);
    if (conversation.sessionId === sessionId) startNewConversation();
    try {
      const response = await fetch("/api/rag/session", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: conversation.sessionId }),
      });
      if (!response.ok) throw new Error("服务端会话删除失败");
    } catch {
      setError("会话已删除");
    }
  }

  function startNewConversation() {
    setSessionId(createSessionId());
    setConversationQuestion("");
    setMessages([]);
    setTurns([]);
    setError("");
    window.history.replaceState(null, "", "/ask");
  }

  return (
    <section className={`rag-panel${standalone ? " rag-workspace" : " rag-entry"}`}>
      {!enabled && <p className="form-error">LLM API 尚未配置，暂时无法生成回答</p>}
      {error && <p className="form-error">{error}</p>}

      {standalone && (
        <>
          {conversationHistory.length > 0 && (
            <ConversationHistory
              activeSessionId={sessionId}
              conversations={conversationHistory}
              disabled={pending}
              onDelete={deleteConversation}
              onNew={startNewConversation}
              onSelect={loadConversation}
            />
          )}
          <div className="rag-conversation">
          {turns.map((turn, index) => (
            <article className="rag-exchange" key={`${sessionId}-${turn.historyId ?? index}`}>
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
                {turn.status !== "winning" && (
                  <div className="rag-answer-actions">
                    {turn.answer && (
                      <button aria-label="复制回答" onClick={() => void copyAnswer(turn.answer, index)} type="button">
                        {copiedTurn === index ? <RiCheckLine /> : <RiFileCopyLine />}
                      </button>
                    )}
                    <button aria-label="重新生成" disabled={pending} onClick={() => void regenerate(index)} type="button">
                      <RiRefreshLine />
                    </button>
                    {turn.status === "winned" && (
                      <>
                        <button
                          aria-label="回答有帮助"
                          className={turn.feedback === "helpful" ? "is-active" : ""}
                          onClick={() => void sendFeedback(index, "helpful")}
                          type="button"
                        >
                          {turn.feedback === "helpful" ? <RiThumbUpFill /> : <RiThumbUpLine />}
                        </button>
                        <button
                          aria-label="回答没有帮助"
                          className={turn.feedback === "unhelpful" ? "is-active" : ""}
                          onClick={() => void sendFeedback(index, "unhelpful")}
                          type="button"
                        >
                          {turn.feedback === "unhelpful" ? <RiThumbDownFill /> : <RiThumbDownLine />}
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            </article>
          ))}
          </div>
        </>
      )}

      <form className="search-form rag-form" onSubmit={submit}>
        <label className="sr-only" htmlFor="rag-question">向 AI 助手提问</label>
        <input
          disabled={!enabled || navigating}
          id="rag-question"
          onChange={(event) => setInput(event.target.value)}
          placeholder={standalone ? "继续追问…" : "询问校园信息或日常问题"}
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

type SavedConversation = {
  initialQuestion: string;
  sessionId: string;
  messages: RagMessage[];
  turns: AnswerTurn[];
  updatedAt: number;
};

const conversationKey = "njupt-win:rag-conversations:v2";

function createSessionId(): string {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID().replaceAll("-", "")
    : `${Date.now()}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`;
}

function readConversations(): SavedConversation[] {
  try {
    const value = JSON.parse(localStorage.getItem(conversationKey) ?? "[]") as SavedConversation[];
    if (!Array.isArray(value)) return [];
    return value
      .filter((item) =>
        item?.sessionId
        && typeof item.initialQuestion === "string"
        && Number.isFinite(item.updatedAt)
        && Array.isArray(item.messages)
        && Array.isArray(item.turns),
      )
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 12);
  } catch {
    return [];
  }
}

function writeConversation(value: SavedConversation): SavedConversation[] {
  const conversations = [value, ...readConversations().filter((item) => item.sessionId !== value.sessionId)]
    .slice(0, 12);
  try {
    localStorage.setItem(conversationKey, JSON.stringify(conversations));
  } catch {
    // 隐私模式或存储配额不足时继续问答，只是不再持久化本轮会话。
  }
  return conversations;
}

function removeConversation(sessionId: string): SavedConversation[] {
  const conversations = readConversations().filter((item) => item.sessionId !== sessionId);
  try {
    localStorage.setItem(conversationKey, JSON.stringify(conversations));
  } catch {
    // 删除服务端记录仍会继续执行，本地存储不可写时不阻断界面操作。
  }
  return conversations;
}

function ConversationHistory({
  activeSessionId,
  conversations,
  disabled,
  onDelete,
  onNew,
  onSelect,
}: {
  activeSessionId: string;
  conversations: SavedConversation[];
  disabled: boolean;
  onDelete: (conversation: SavedConversation) => void;
  onNew: () => void;
  onSelect: (conversation: SavedConversation) => void;
}) {
  return (
    <details className="rag-history">
      <summary><RiHistoryLine /> 对话历史</summary>
      <div className="rag-history-list">
        <button className="rag-history-new" disabled={disabled} onClick={onNew} type="button">
          新对话
        </button>
        {conversations.map((conversation) => (
          <div className={conversation.sessionId === activeSessionId ? "is-active" : ""} key={conversation.sessionId}>
            <button disabled={disabled} onClick={() => onSelect(conversation)} type="button">
              <strong>{conversation.initialQuestion}</strong>
              <span>{conversation.turns.length} 轮 · {formatHistoryTime(conversation.updatedAt)}</span>
            </button>
            <button
              aria-label={`删除对话：${conversation.initialQuestion}`}
              disabled={disabled}
              onClick={() => onDelete(conversation)}
              type="button"
            >
              <RiDeleteBinLine />
            </button>
          </div>
        ))}
      </div>
    </details>
  );
}

function formatHistoryTime(value: number): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function replaceAskUrl(question: string) {
  window.history.replaceState(null, "", `/ask?q=${encodeURIComponent(question)}`);
}

/** 将模型返回的流式片段缓冲为稳定的逐字显示，避免较大数据块突然跳入页面 */
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
  const content = displayed || (status === "winning" ? "正在思考并组织回答…" : "未生成回答。");
  return <div className={`rag-answer${streaming ? " rag-answer-streaming" : ""}`}>{content}</div>;
}

/** 来源始终保留在 DOM 中，通过网格行高实现可逆的平滑展开 */
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

/** 首页提交时使用克隆节点执行 FLIP，衔接到问答页底部的同形输入框 */
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
    // 浏览器取消动画时仍继续进入问答页，避免导航被视觉增强阻断
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
    source.evidences.filter((evidence) => evidence.type === "image" && safePublicUrl(evidence.assetUrl)),
  );
  const attachments = sources.flatMap((source) =>
    source.evidences.filter((evidence) => evidence.type === "attachment" && safePublicUrl(evidence.assetUrl)),
  );
  if (images.length === 0 && attachments.length === 0) return null;
  return (
    <section className="rag-evidence">
      {images.length > 0 && (
        <div className="rag-image-gallery">
          {images.map((image, index) => (
            <a href={safePublicUrl(image.assetUrl)!} key={`${image.assetUrl}-${index}`} rel="noreferrer" target="_blank">
              <img alt={image.title} src={safePublicUrl(image.assetUrl)!} />
              <span>{image.title}</span>
            </a>
          ))}
        </div>
      )}
      {attachments.length > 0 && (
        <div className="rag-attachment-list">
          {attachments.map((attachment, index) => (
            <a href={safePublicUrl(attachment.assetUrl)!} key={`${attachment.assetUrl}-${index}`} rel="noreferrer" target="_blank">
              {attachment.title}
            </a>
          ))}
        </div>
      )}
    </section>
  );
}

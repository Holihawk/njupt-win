"use client";

import type { CSSProperties, FormEvent } from "react";
import { useEffect, useState } from "react";
import { RiCalendarCloseFill, RiCalendarCloseLine, RiCalendarEventFill } from "react-icons/ri";
import type { CalendarStatus } from "../src/content/calendar";
import {
  createPersonalReminder,
  defaultPersonalReminders,
  daysUntilReminder,
  initializePersonalReminders,
  parsePersonalReminders,
  PERSONAL_REMINDERS_STORAGE_KEY,
  type PersonalReminder,
} from "../src/content/personal-reminders";

/** 渲染校历进度，并在浏览器本地维护用户自己的备忘节点 */
export function CalendarCard({ status }: { status: CalendarStatus | null }) {
  const [editing, setEditing] = useState(false);
  // 先渲染服务端提供的默认节点，避免首次打开或浏览器存储异常时只看到进度条
  const [reminders, setReminders] = useState<PersonalReminder[]>(() =>
    defaultPersonalReminders(status?.events ?? []),
  );

  // Local Storage 只能在浏览器访问，因此在组件挂载后读取，避免服务端渲染报错
  useEffect(() => {
    const stored = readStoredReminders();
    const initialized = initializePersonalReminders(stored, status?.events ?? []);
    setReminders(initialized);
    if (stored === null) persistReminders(initialized);
  }, [status?.events]);

  if (!status) return <section className="calendar-card">暂无校历配置</section>;

  function addReminder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const title = String(form.get("title") ?? "").trim();
    const date = String(form.get("date") ?? "");
    if (!title || !date) return;
    const next = [...reminders, createPersonalReminder(title, date)].sort((a, b) =>
      a.date.localeCompare(b.date),
    );
    setReminders(next);
    persistReminders(next);
    event.currentTarget.reset();
    setEditing(false);
  }

  function removeReminder(id: string) {
    const next = reminders.filter((reminder) => reminder.id !== id);
    setReminders(next);
    persistReminders(next);
  }

  function restoreDefaults() {
    const personal = reminders.filter((reminder) => reminder.source === "personal");
    const next = [...defaultPersonalReminders(status?.events ?? []), ...personal].sort((a, b) =>
      a.date.localeCompare(b.date),
    );
    setReminders(next);
    persistReminders(next);
  }

  return (
    <section className="calendar-card">
      <div className="calendar-heading">
        <p className="eyebrow">{status.mode === "term" ? "校历进度" : "开学进度"}</p>
        <button
          aria-controls="calendar-reminder-editor"
          aria-expanded={editing}
          aria-label="管理节点"
          className="reminder-settings"
          onClick={() => setEditing((value) => !value)}
          type="button"
        >
          <RiCalendarEventFill aria-hidden="true" />
        </button>
      </div>
      <h2>{status.title}</h2>
      <p className="muted">{status.subtitle}</p>
      <div
        aria-label={`进度 ${status.progressPercent}%`}
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={status.progressPercent}
        className="progress"
        role="progressbar"
        style={{ "--progress": `${status.progressPercent}%` } as CSSProperties}
      >
        <span className="progress-fill" />
      </div>
      <div className="progress-label">
        <strong>{status.progressPercent}%</strong>
        <span>
          {status.mode === "term" ? "距离本学期结束" : "距离开学"} {status.daysRemaining} 天
        </span>
      </div>
      <div
        aria-hidden={!editing}
        className="reminder-editor-reveal"
        data-open={editing}
        id="calendar-reminder-editor"
        inert={!editing}
      >
        <div className="reminder-editor">
          <div className="reminder-editor-heading">
            <strong>管理节点</strong>
            <button onClick={restoreDefaults} type="button">恢复默认</button>
          </div>
          <form className="reminder-form" onSubmit={addReminder}>
            <input aria-label="备忘名称" maxLength={30} name="title" placeholder="课程考试 / 项目 DDL" required />
            <input aria-label="备忘日期" name="date" required type="date" />
            <button type="submit">添加</button>
          </form>
          <p>下方所有节点均可删除，修改会保存在当前浏览器</p>
        </div>
      </div>
      <div className="event-list">
        {reminders.map((reminder) => (
          <div className="event-countdown personal-reminder" key={reminder.id}>
            <span>
              <strong>{reminder.title}</strong>
              <small>{reminder.date} · {reminder.source === "default" ? " " : "个人备忘"}</small>
            </span>
            <div>
              <b>{formatReminderDays(daysUntilReminder(reminder.date))}</b>
              {editing && (
                <button aria-label={`删除${reminder.title}`} onClick={() => removeReminder(reminder.id)} type="button">
                  <span aria-hidden="true" className="icon-swap">
                    <span className="icon-line"><RiCalendarCloseLine /></span>
                    <span className="icon-fill"><RiCalendarCloseFill /></span>
                  </span>
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
      <a href={status.sourceUrl} rel="noreferrer" target="_blank">
        查看校历
      </a>
    </section>
  );
}

/** 将个人节点的日差转换为简短、易扫描的文本 */
function formatReminderDays(days: number): string {
  if (days === 0) return "今天";
  if (days < 0) return `已过 ${Math.abs(days)} 天`;
  return `${days} 天`;
}

/** 统一写入 Local Storage，便于所有添加、删除和恢复操作保持一致 */
function persistReminders(reminders: PersonalReminder[]) {
  try {
    localStorage.setItem(PERSONAL_REMINDERS_STORAGE_KEY, JSON.stringify(reminders));
  } catch {
    // 浏览器禁用 Local Storage 时仍保留当前会话中的 React 状态，不让设置面板失效
  }
}

/** 安全读取本地事件；隐私模式或存储权限异常时按首次使用处理 */
function readStoredReminders(): string | null {
  try {
    return localStorage.getItem(PERSONAL_REMINDERS_STORAGE_KEY);
  } catch {
    return null;
  }
}

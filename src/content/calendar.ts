import { readFile } from "node:fs/promises";
import path from "node:path";

export type AcademicTerm = {
  name: string;
  startDate: string;
  endDate: string;
  teachingWeeks: number;
  nextTermStartDate: string;
  sourceUrl: string;
};

export type CalendarEvent = {
  id: string;
  title: string;
  shortTitle: string;
  date: string;
  type: "exam" | "holiday" | "registration" | "custom";
  visible: boolean;
  sourceUrl?: string;
};

export type CalendarEventStatus = CalendarEvent & {
  daysRemaining: number;
};

export type CalendarStatus =
  | {
      mode: "term";
      title: string;
      subtitle: string;
      progressPercent: number;
      daysRemaining: number;
      sourceUrl: string;
      events: CalendarEventStatus[];
    }
  | {
      mode: "break";
      title: string;
      subtitle: string;
      progressPercent: number;
      daysRemaining: number;
      sourceUrl: string;
      events: CalendarEventStatus[];
    };

/**
 * 根据当前日期计算校历卡片展示状态。
 *
 * 学期内返回教学周、学期进度和剩余天数；寒暑假或学期间隙返回距离开学的进度。
 * 所有比较都先转换为 YYYY-MM-DD，避免时区和夏令时影响“相差几天”的结果。
 */
export function getCalendarStatus(
  terms: AcademicTerm[],
  now: Date,
  events: CalendarEvent[] = [],
): CalendarStatus | null {
  const today = localDate(now);
  const upcomingEvents = getUpcomingEvents(events, today);
  const current = terms.find(
    (term) => today >= term.startDate && today <= term.endDate,
  );

  if (current) {
    const elapsedDays = diffDays(current.startDate, today);
    const currentWeek = Math.min(Math.floor(elapsedDays / 7) + 1, current.teachingWeeks);
    const totalDays = diffDays(current.startDate, current.endDate) + 1;
    return {
      mode: "term",
      title: `第 ${currentWeek} 教学周`,
      subtitle: current.name,
      progressPercent: clamp(Math.round(((elapsedDays + 1) / totalDays) * 100)),
      daysRemaining: Math.max(diffDays(today, current.endDate), 0),
      sourceUrl: current.sourceUrl,
      events: upcomingEvents,
    };
  }

  const previous = [...terms]
    .filter((term) => term.endDate < today && term.nextTermStartDate > today)
    .sort((a, b) => b.endDate.localeCompare(a.endDate))[0];
  if (previous) {
    const breakStart = addDays(previous.endDate, 1);
    const totalDays = Math.max(diffDays(breakStart, previous.nextTermStartDate), 1);
    const elapsedDays = Math.max(diffDays(breakStart, today), 0);
    return {
      mode: "break",
      title: "假期中",
      subtitle: `下一学期开学：${formatDate(previous.nextTermStartDate)}`,
      progressPercent: clamp(Math.round((elapsedDays / totalDays) * 100)),
      daysRemaining: Math.max(diffDays(today, previous.nextTermStartDate), 0),
      sourceUrl: previous.sourceUrl,
      events: upcomingEvents,
    };
  }

  const next = [...terms].filter((term) => term.startDate > today).sort((a, b) =>
    a.startDate.localeCompare(b.startDate),
  )[0];
  if (!next) return null;
  return {
    mode: "break",
    title: "等待新学期",
    subtitle: `开学日期：${formatDate(next.startDate)}`,
    progressPercent: 0,
    daysRemaining: diffDays(today, next.startDate),
    sourceUrl: next.sourceUrl,
    events: upcomingEvents,
  };
}

/**
 * 并行读取学期与事件配置。
 *
 * 两类数据分文件保存，方便人工维护，也便于后续 AI 抓取任务只更新事件文件。
 */
export async function loadCalendarConfig(): Promise<{
  terms: AcademicTerm[];
  events: CalendarEvent[];
}> {
  const [termsValue, eventsValue] = await Promise.all([
    readFile(path.join(process.cwd(), "data/calendar.json"), "utf8"),
    readFile(path.join(process.cwd(), "data/calendar-events.json"), "utf8"),
  ]);
  return {
    terms: (JSON.parse(termsValue) as { terms: AcademicTerm[] }).terms,
    events: (JSON.parse(eventsValue) as { events: CalendarEvent[] }).events,
  };
}

/** 过滤已结束或隐藏的事件，并计算未来事件倒计时。 */
function getUpcomingEvents(events: CalendarEvent[], today: string): CalendarEventStatus[] {
  return events
    .filter((event) => event.visible && event.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((event) => ({ ...event, daysRemaining: diffDays(today, event.date) }));
}

/** 将本地 Date 格式化为不含时分秒的日期字符串。 */
function localDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

/** 使用 UTC 零点计算两个日期间的自然日差，避免跨时区误差。 */
function diffDays(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** 在日期字符串上增加自然日，用于计算假期开始日期。 */
function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

/** 将百分比限制在合法的 0-100 范围内。 */
function clamp(value: number): number {
  return Math.max(0, Math.min(100, value));
}

/** 将 YYYY-MM-DD 转成适合卡片展示的中文月日。 */
function formatDate(date: string): string {
  const [, month, day] = date.split("-");
  return `${Number(month)} 月 ${Number(day)} 日`;
}

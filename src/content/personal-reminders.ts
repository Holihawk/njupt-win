import type { CalendarEventStatus } from "./calendar";

/** 浏览器 Local Storage 中保存可编辑校历节点的固定键名。 */
export const PERSONAL_REMINDERS_STORAGE_KEY = "njupt-win:calendar-reminders:v3";

/** 默认校历事件和个人备忘统一使用此结构，才能在同一界面添加、删除和排序。 */
export type PersonalReminder = {
  id: string;
  title: string;
  date: string;
  createdAt: string;
  source: "default" | "personal";
  sourceUrl?: string;
};

/**
 * 安全解析 Local Storage 内容。
 *
 * 用户可能手动修改浏览器存储，旧版本结构也可能不兼容，因此逐项校验，
 * 无效数据直接忽略，避免校历卡片因一条坏数据无法渲染。
 */
export function parsePersonalReminders(raw: string | null): PersonalReminder[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) return [];
    return value.filter(isPersonalReminder).sort((a, b) => a.date.localeCompare(b.date));
  } catch {
    return [];
  }
}

/**
 * 初始化用户的可编辑事件列表。
 *
 * v3 存储尚不存在时合并默认事件和旧数据。这样可以修复旧版曾在部分访问地址下
 * 写入空数组、导致默认事件永久不显示的问题。初始化完成后，删除结果会写入 v3，
 * 后续刷新不会自动把已删除事件加回来。
 */
export function initializePersonalReminders(
  raw: string | null,
  defaults: CalendarEventStatus[],
): PersonalReminder[] {
  if (raw !== null) return parsePersonalReminders(raw);
  return mergeDefaultReminders(defaults, readLegacyPersonalReminders());
}

/** 将服务端默认校历事件转换为可编辑的本地事件。 */
export function defaultPersonalReminders(defaults: CalendarEventStatus[]): PersonalReminder[] {
  return defaults.map((event) => ({
    id: `default:${event.id}`,
    title: event.shortTitle,
    date: event.date,
    createdAt: new Date().toISOString(),
    source: "default",
    sourceUrl: event.sourceUrl,
  }));
}

/** 首次升级到 v3 时保留旧版个人备忘，并补齐旧版可能缺失的默认节点。 */
function mergeDefaultReminders(
  defaults: CalendarEventStatus[],
  legacyReminders: PersonalReminder[],
): PersonalReminder[] {
  const personal = legacyReminders.filter((reminder) => reminder.source === "personal");
  return [...defaultPersonalReminders(defaults), ...personal].sort((a, b) =>
    a.date.localeCompare(b.date),
  );
}

/** 浏览器端读取 v2 数据；服务端渲染和禁用存储时直接按无旧数据处理。 */
function readLegacyPersonalReminders(): PersonalReminder[] {
  try {
    if (typeof localStorage === "undefined") return [];
    return parsePersonalReminders(localStorage.getItem("njupt-win:calendar-reminders:v2"));
  } catch {
    return [];
  }
}

/** 计算个人节点距离指定日期的自然日数；负数表示事件已经过去。 */
export function daysUntilReminder(date: string, now = new Date()): number {
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate(),
  ).padStart(2, "0")}`;
  return Math.round(
    (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000,
  );
}

/** 创建带稳定 ID 的个人备忘，并清理用户输入两端空白。 */
export function createPersonalReminder(title: string, date: string): PersonalReminder {
  return {
    id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
    title: title.trim(),
    date,
    createdAt: new Date().toISOString(),
    source: "personal",
  };
}

function isPersonalReminder(value: unknown): value is PersonalReminder {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Partial<PersonalReminder>;
  return (
    typeof item.id === "string" &&
    typeof item.title === "string" &&
    item.title.trim().length > 0 &&
    typeof item.date === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(item.date) &&
    typeof item.createdAt === "string" &&
    (item.source === "default" || item.source === "personal")
  );
}

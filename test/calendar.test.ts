import { describe, expect, it } from "vitest";
import type { AcademicTerm, CalendarEvent } from "../src/content/calendar.js";
import { getCalendarStatus } from "../src/content/calendar.js";
import {
  daysUntilReminder,
  initializePersonalReminders,
  parsePersonalReminders,
} from "../src/content/personal-reminders.js";

const terms: AcademicTerm[] = [{
  name: "测试学期",
  startDate: "2026-03-02",
  endDate: "2026-07-05",
  teachingWeeks: 18,
  nextTermStartDate: "2026-08-31",
  sourceUrl: "https://example.com",
}];
const events: CalendarEvent[] = [{
  id: "cet",
  title: "四六级",
  shortTitle: "四六级",
  date: "2026-06-13",
  type: "exam",
  visible: true,
}];

describe("calendar status", () => {
  it("shows teaching week during a term", () => {
    const status = getCalendarStatus(terms, new Date(2026, 5, 6), events);
    expect(status?.mode).toBe("term");
    expect(status?.title).toBe("第 14 教学周");
    expect(status?.events[0].daysRemaining).toBe(7);
  });

  it("shows opening progress during a break", () => {
    const status = getCalendarStatus(terms, new Date(2026, 6, 20));
    expect(status?.mode).toBe("break");
    expect(status?.daysRemaining).toBe(42);
  });
});

describe("personal reminders", () => {
  it("safely parses local storage reminders", () => {
    const value = JSON.stringify([
      {
        id: "1",
        title: "项目 DDL",
        date: "2026-06-20",
        createdAt: "2026-06-07",
        source: "personal",
      },
      { invalid: true },
    ]);
    expect(parsePersonalReminders(value)).toHaveLength(1);
  });

  it("calculates reminder countdown in natural days", () => {
    expect(daysUntilReminder("2026-06-13", new Date(2026, 5, 7))).toBe(6);
  });

  it("uses default calendar events only before v3 local state is initialized", () => {
    const status = getCalendarStatus(terms, new Date(2026, 5, 6), events)!;
    expect(initializePersonalReminders(null, status.events)).toHaveLength(1);
    expect(initializePersonalReminders("[]", status.events)).toHaveLength(0);
  });
});

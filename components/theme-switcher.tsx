"use client";

import { useEffect, useRef, useState } from "react";
import {
  RiComputerLine,
  RiMoonLine,
  RiShowersLine,
  RiSunFill,
} from "react-icons/ri";

export type ThemeChoice = "rain" | "light" | "dark" | "system";

const THEME_STORAGE_KEY = "njupt-theme";

const themeOptions: Array<{ value: ThemeChoice; label: string }> = [
  { value: "rain", label: "Rain" },
  { value: "light", label: "亮色" },
  { value: "dark", label: "暗色" },
  { value: "system", label: "跟随系统" },
];

/** 主题菜单只保存用户选择；system 会实时解析为 light 或 dark 写入根节点。 */
export function ThemeSwitcher() {
  const [choice, setChoice] = useState<ThemeChoice>("rain");
  const detailsRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const initial = normalizeTheme(document.documentElement.dataset.themeChoice);
    setChoice(initial);
    applyTheme(initial);

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const syncSystemTheme = () => {
      if (document.documentElement.dataset.themeChoice === "system") applyTheme("system");
    };
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!detailsRef.current?.contains(event.target as Node)) detailsRef.current?.removeAttribute("open");
    };
    media.addEventListener("change", syncSystemTheme);
    document.addEventListener("pointerdown", closeOnOutsideClick);
    return () => {
      media.removeEventListener("change", syncSystemTheme);
      document.removeEventListener("pointerdown", closeOnOutsideClick);
    };
  }, []);

  function selectTheme(next: ThemeChoice) {
    setChoice(next);
    applyTheme(next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // 浏览器禁用持久化时仍允许当前页面正常切换主题。
    }
    detailsRef.current?.removeAttribute("open");
  }

  return (
    <details className="theme-switcher" ref={detailsRef}>
      <summary aria-label="切换主题" title="切换主题">
        <span className="theme-trigger-icon theme-trigger-rain"><RiShowersLine /></span>
        <span className="theme-trigger-icon theme-trigger-light"><RiSunFill /></span>
        <span className="theme-trigger-icon theme-trigger-dark"><RiMoonLine /></span>
        <span className="theme-trigger-icon theme-trigger-system-light"><RiSunFill /></span>
        <span className="theme-trigger-icon theme-trigger-system-dark"><RiMoonLine /></span>
        <span className="theme-label">主题</span>
      </summary>
      <div className="theme-menu">
        {themeOptions.map((option) => (
          <button
            aria-pressed={choice === option.value}
            key={option.value}
            onClick={() => selectTheme(option.value)}
            type="button"
          >
            <ThemeOptionIcon choice={option.value} />
            <span>{option.label}</span>
          </button>
        ))}
      </div>
    </details>
  );
}

function ThemeOptionIcon({ choice }: { choice: ThemeChoice }) {
  if (choice === "rain") return <RiShowersLine />;
  if (choice === "light") return <RiSunFill />;
  if (choice === "dark") return <RiMoonLine />;
  return <RiComputerLine />;
}

function applyTheme(choice: ThemeChoice) {
  const resolved = choice === "system"
    ? window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
    : choice;
  document.documentElement.dataset.themeChoice = choice;
  document.documentElement.dataset.theme = resolved;
}

function normalizeTheme(value: string | undefined): ThemeChoice {
  return value === "light" || value === "dark" || value === "system" ? value : "rain";
}

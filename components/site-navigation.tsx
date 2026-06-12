"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  RiHome3Fill,
  RiHome3Line,
  RiPokerHeartsFill,
  RiPokerHeartsLine,
  RiSearchFill,
  RiSearchLine,
} from "react-icons/ri";
import { ThemeSwitcher } from "./theme-switcher";

/** 顶部导航根据当前页面切换线性/填充图标，并固定主题入口顺序。 */
export function SiteNavigation() {
  const pathname = usePathname();

  return (
    <nav>
      <NavLink active={pathname === "/"} fill={<RiHome3Fill />} href="/" line={<RiHome3Line />} label="首页" />
      <NavLink
        active={pathname.startsWith("/search")}
        fill={<RiSearchFill />}
        href="/search"
        line={<RiSearchLine />}
        label="搜索"
      />
      <ThemeSwitcher />
      <NavLink
        active={pathname.startsWith("/about")}
        fill={<RiPokerHeartsFill />}
        href="/about"
        line={<RiPokerHeartsLine />}
        label="关于"
      />
    </nav>
  );
}

function NavLink({
  active,
  fill,
  href,
  label,
  line,
}: {
  active: boolean;
  fill: React.ReactNode;
  href: string;
  label: string;
  line: React.ReactNode;
}) {
  return (
    <Link aria-current={active ? "page" : undefined} href={href}>
      <span className="nav-icon" aria-hidden="true">{active ? fill : line}</span>
      {label}
    </Link>
  );
}

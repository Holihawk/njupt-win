import type { Metadata } from "next";
import Link from "next/link";
import { SiteNavigation } from "../components/site-navigation";
import "./globals.css";

export const metadata: Metadata = {
  title: "njupt.win",
  description: "南邮公开通知与校历信息",
  icons: {
    icon: "/images/Wheelchair 2.png",
  },
};

const themeInitializer = `
  (() => {
    try {
      const stored = localStorage.getItem("njupt-theme");
      const choice = ["rain", "light", "dark", "system"].includes(stored) ? stored : "rain";
      const resolved = choice === "system"
        ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
        : choice;
      document.documentElement.dataset.themeChoice = choice;
      document.documentElement.dataset.theme = resolved;
    } catch {
      document.documentElement.dataset.themeChoice = "rain";
      document.documentElement.dataset.theme = "rain";
    }
  })();
`;

/** 全站共享布局：透明导航、页面主体和非官方免责声明 */
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html data-theme="rain" data-theme-choice="rain" lang="zh-CN" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitializer }} />
      </head>
      <body>
        <header className="site-header">
          <Link className="brand" href="/">
            <img alt="" height="42" src="/images/Wheelchair 2.png" width="42" />
            <span>njupt.win</span>
          </Link>
          <SiteNavigation />
        </header>
        {children}
        <footer>
          <span>本站为非官方校园信息工具，内容来自公开网页，重要事项请以官方原文为准</span>
          <a href="https://icp.gov.moe/?keyword=20268420" rel="noreferrer" target="_blank">
            萌ICP备20268420号
          </a>
        </footer>
      </body>
    </html>
  );
}

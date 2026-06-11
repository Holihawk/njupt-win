import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "njupt.win",
  description: "南邮公开通知与校历信息",
  icons: {
    icon: "/iamges/Wheelchair 2.png",
  },
};

/** 全站共享布局：透明导航、页面主体和非官方免责声明 */
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>
        <header className="site-header">
          <Link className="brand" href="/">
            <img alt="" height="42" src="/iamges/Wheelchair 2.png" width="42" />
            <span>njupt.win</span>
          </Link>
          <nav>
            <Link href="/"><img alt="" src="/iamges/home-3-line.png" />首页</Link>
            <Link href="/search"><img alt="" src="/iamges/search-line.png" />搜索</Link>
            <Link href="/about"><img alt="" src="/iamges/heart-line.png" />关于</Link>
          </nav>
        </header>
        {children}
        <footer>
          本站为非官方校园信息工具，内容来自公开网页，重要事项请以官方原文为准
        </footer>
      </body>
    </html>
  );
}

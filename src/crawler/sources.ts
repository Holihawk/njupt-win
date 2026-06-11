import type { SourceConfig } from "../types.js";

/**
 * 白名单公开数据源。
 *
 * 只允许在这里显式配置的页面进入抓取流程，避免爬虫意外扩散到登录页或无关站点。
 */
export const sources: SourceConfig[] = [
  {
    id: "njupt-main",
    name: "南京邮电大学官网",
    baseUrl: "https://www.njupt.edu.cn",
    listUrl: "https://www.njupt.edu.cn/72/list.htm",
  },
  {
    id: "njupt-jwc",
    name: "南京邮电大学本科生院",
    baseUrl: "https://jwc.njupt.edu.cn",
    listUrl: "https://jwc.njupt.edu.cn/1594/list.htm",
  },
];

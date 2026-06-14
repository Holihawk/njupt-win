import { withApiFailover } from "../ai/api-pool";
import type { RagMessage } from "./index";

export type RagRouteMode = "campus_rag" | "general_chat" | "mixed" | "unsafe";

export type RagRoute = {
  mode: RagRouteMode;
  retrievalQuery: string;
  reason: string;
};

/**
 * 规则路由覆盖明确问题；校园短追问和混合任务属于歧义问题，会交给 LLM 同时完成分类
 * 与独立检索句改写。LLM 路由失败时始终回退到规则结果，不阻断用户问答。
 */
export async function routeRagQuestion(messages: RagMessage[]): Promise<RagRoute> {
  const current = [...messages].reverse().find((message) => message.role === "user")?.content.trim() ?? "";
  const safetyRoute = unsafeRagRoute(current);
  if (safetyRoute) return safetyRoute;
  const fallback = fallbackRagRoute(messages);
  if (!needsLlmRouting(messages, fallback)) return fallback;

  try {
    return await withApiFailover("LLM", async (endpoint) => {
      const response = await fetch(endpoint.url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${endpoint.key}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: endpoint.model,
          temperature: 0,
          max_tokens: 180,
          messages: [
            {
              role: "system",
              content:
                "你是问答路由器。只输出 JSON："
                + '{"mode":"campus_rag|general_chat|mixed|unsafe","retrievalQuery":"string","reason":"string"}。'
                + "campus_rag=查询南京邮电大学事实；general_chat=普通知识、写作或聊天；"
                + "mixed=需要校园事实又需要通用分析或规划；unsafe=明显要求违法、伤害或泄露隐私。"
                + "校园追问必须结合上文改写成可独立检索的 retrievalQuery；无需检索时 retrievalQuery 为空。",
            },
            {
              role: "user",
              content: messages.slice(-6).map((message) => `${message.role}: ${message.content}`).join("\n").slice(0, 6000),
            },
          ],
        }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json() as { choices?: { message?: { content?: string } }[] };
      return parseRagRoute(payload.choices?.[0]?.message?.content, fallback);
    });
  } catch {
    return fallback;
  }
}

export function fallbackRagRoute(messages: RagMessage[]): RagRoute {
  const userMessages = messages
    .filter((message) => message.role === "user")
    .slice(-4)
    .map((message) => message.content.toLocaleLowerCase("zh-CN"));
  const current = userMessages.at(-1) ?? "";

  const generalTask = /翻译|润色|改写|写.*(诗|故事|小说|文案|祝福|邮件|作文)|代码|编程|算法|计算|解方程|讲故事|聊天|你好|早上好|晚上好|笑话|怎么复习|如何复习|备考建议|学习建议/;
  const safetyRoute = unsafeRagRoute(current);
  if (safetyRoute) return safetyRoute;
  if (generalTask.test(current)) return { mode: "general_chat", retrievalQuery: "", reason: "规则识别为通用任务" };

  const campusTopic = /南京邮电|南邮|njupt|仙林校区|三牌楼校区|锁金村校区|教务处|学工处|学生工作处|研究生院|校园卡|一卡通|学生证|校园网|校历|选课|补考|缓考|重修|课程表|考试|成绩|教室|宿舍|食堂|校车|奖学金|助学金|图书馆|辅导员|学分|培养方案|转专业|保研|毕业|学位|体测|门禁|新生报到|学校通知|学院通知|放假|开学|学费|缴费|在读证明|请假|离校|入校/;
  const mixedTask = /根据|结合|制定|规划|建议|分析|比较|总结|整理|撰写/;
  if (campusTopic.test(current) && mixedTask.test(current)) {
    return { mode: "mixed", retrievalQuery: current, reason: "规则识别为校园资料与通用分析混合任务" };
  }
  if (campusTopic.test(current)) {
    return { mode: "campus_rag", retrievalQuery: current, reason: "规则识别为校园事实问题" };
  }

  // 只有明显依赖上文的短追问才继承校园模式，避免切换话题后仍检索旧问题。
  const contextualFollowUp = /^(那|那么|这个|具体|还有|它|上述|前面|需要|怎么|为什么|什么时候|在哪里|多少|可以|能否|是否)/;
  if (contextualFollowUp.test(current.trim()) && campusTopic.test(userMessages.slice(0, -1).join(" "))) {
    return {
      mode: "campus_rag",
      retrievalQuery: `${userMessages.at(-2) ?? ""} ${current}`.trim(),
      reason: "规则识别为校园问题追问",
    };
  }
  return { mode: "general_chat", retrievalQuery: "", reason: "未发现校园事实检索需求" };
}

function unsafeRagRoute(current: string): RagRoute | null {
  const unsafeTask =
    /制作炸弹|自制炸药|爆炸物制作|入侵系统|绕过认证|窃取密码|盗取账号|泄露隐私|人肉搜索|自杀方法|伤害自己|伤害他人|系统提示词|开发者消息|api\s*key|泄露密钥|输出密钥/;
  return unsafeTask.test(current)
    ? { mode: "unsafe", retrievalQuery: "", reason: "规则识别为高风险请求" }
    : null;
}

export function routeUsesCampusSources(route: RagRoute): boolean {
  return route.mode === "campus_rag" || route.mode === "mixed";
}

/** 兼容已有调用方；新代码应优先使用带模式与改写结果的 routeRagQuestion。 */
export function shouldUseCampusRetrieval(messages: RagMessage[]): boolean {
  return routeUsesCampusSources(fallbackRagRoute(messages));
}

function needsLlmRouting(messages: RagMessage[], fallback: RagRoute): boolean {
  if (fallback.mode === "mixed" || fallback.reason.includes("追问")) return true;
  if (fallback.reason !== "未发现校园事实检索需求") return false;
  const current = [...messages].reverse().find((message) => message.role === "user")?.content.trim() ?? "";
  return current.length <= 6;
}

function parseRagRoute(value: string | undefined, fallback: RagRoute): RagRoute {
  if (!value) return fallback;
  try {
    const json = value.match(/\{[\s\S]*\}/)?.[0];
    if (!json) return fallback;
    const parsed = JSON.parse(json) as Partial<RagRoute>;
    const modes: RagRouteMode[] = ["campus_rag", "general_chat", "mixed", "unsafe"];
    if (!parsed.mode || !modes.includes(parsed.mode)) return fallback;
    const requiresRetrieval = parsed.mode === "campus_rag" || parsed.mode === "mixed";
    const retrievalQuery = requiresRetrieval
      ? parsed.retrievalQuery?.trim().slice(0, 500) || fallback.retrievalQuery
      : "";
    if (requiresRetrieval && !retrievalQuery) return fallback;
    return {
      mode: parsed.mode,
      retrievalQuery,
      reason: parsed.reason?.trim().slice(0, 200) || "LLM 结构化路由",
    };
  } catch {
    return fallback;
  }
}

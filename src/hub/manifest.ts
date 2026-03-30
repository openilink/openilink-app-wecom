/**
 * OpeniLink Hub App 清单
 * 描述应用基本信息、支持的事件类型和可用工具
 */

import type { ToolDefinition } from "./types.js";

/** App 清单接口 */
export interface AppManifest {
  slug: string;
  name: string;
  icon: string;
  description: string;
  events: string[];
  /** 所需权限范围 */
  scopes: string[];
  tools: ToolDefinition[];
  /** 配置项 JSON Schema */
  config_schema: Record<string, unknown>;
  /** 安装引导说明（Markdown） */
  guide: string;
}

/** 企业微信 Bridge 清单定义 */
export const manifest: AppManifest = {
  slug: "wecom-bridge",
  name: "企业微信 Bridge",
  icon: "\u{1F3E2}",
  description: "微信 ↔ 企业微信双向消息桥接 + 企业微信 AI Tools",
  events: ["message", "command"],
  scopes: ["tools:write", "config:read"],
  tools: [],
  config_schema: {
    type: "object",
    properties: {
      wecom_bot_id: { type: "string", title: "企微 BotID", description: "智能机器人的 BotID" },
      wecom_bot_secret: { type: "string", title: "企微 Bot Secret", description: "智能机器人的 Secret" },
      wecom_corp_id: { type: "string", title: "企业 ID", description: "用于 OpenAPI 调用（可选）" },
      wecom_corp_secret: { type: "string", title: "应用 Secret", description: "自建应用的 Secret（可选）" },
    },
    required: ["wecom_bot_id", "wecom_bot_secret"],
  },
  guide: `## 企业微信 Bridge 安装指南
### 第 1 步：创建智能机器人
1. 企业微信管理后台 → 应用管理 → 智能机器人 → 创建
2. 获取 BotID 和 Secret
### 第 2 步：配置机器人权限
### 第 3 步：（可选）创建自建应用
如需通讯录、审批等高级功能，需额外创建自建应用获取 CorpID 和 CorpSecret
### 第 4 步：填写上方配置并安装
`,
};

/**
 * 返回清单的 JSON 表示
 * 用于响应 Hub 的 manifest 查询请求
 */
export function getManifestJSON(): string {
  return JSON.stringify(manifest, null, 2);
}

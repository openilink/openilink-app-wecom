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
  tools: ToolDefinition[];
}

/** 企业微信 Bridge 清单定义 */
export const manifest: AppManifest = {
  slug: "wecom-bridge",
  name: "企业微信 Bridge",
  icon: "\u{1F3E2}",
  description: "微信 ↔ 企业微信双向消息桥接 + 企业微信 AI Tools",
  events: ["message", "command"],
  tools: [],
};

/**
 * 返回清单的 JSON 表示
 * 用于响应 Hub 的 manifest 查询请求
 */
export function getManifestJSON(): string {
  return JSON.stringify(manifest, null, 2);
}

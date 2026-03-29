/**
 * OpeniLink Hub 协议相关类型定义
 */

/** Hub 推送到 App 的事件结构 */
export interface HubEvent {
  /** 协议版本 */
  v: string;
  /** 事件大类：event（业务事件）或 url_verification（URL 验证） */
  type: "event" | "url_verification";
  /** 追踪 ID，用于日志关联 */
  trace_id: string;
  /** URL 验证时需要原样回传的 challenge 值 */
  challenge?: string;
  /** 安装 ID */
  installation_id: string;
  /** 目标 Bot 信息 */
  bot: { id: string };
  /** 具体事件载荷 */
  event?: {
    type: string;
    id: string;
    timestamp: string;
    data: Record<string, unknown>;
  };
}

/** Hub App 安装记录 */
export interface Installation {
  id: string;
  hubUrl: string;
  appId: string;
  botId: string;
  appToken: string;
  webhookSecret: string;
  createdAt?: string;
}

/** 企业微信 <-> 微信 消息关联记录 */
export interface MessageLink {
  id?: number;
  installationId: string;
  wecomMsgId: string;
  wecomConversation: string;
  wxUserId: string;
  wxUserName: string;
  createdAt?: string;
}

/** AI Tools 工具定义 */
export interface ToolDefinition {
  /** 工具名称 */
  name: string;
  /** 工具描述 */
  description: string;
  /** 工具指令标识 */
  command: string;
  /** JSON Schema 参数定义 */
  parameters?: Record<string, unknown> | Record<string, unknown>[];
}

/** 工具执行上下文 */
export interface ToolContext {
  installationId: string;
  botId: string;
  userId: string;
  traceId: string;
  args: Record<string, unknown>;
}

/** Tool 处理结果 — 支持文本和媒体类型 */
export interface ToolResult {
  /** 回复文本 */
  reply: string;
  /** 回复类型，默认 text */
  reply_type?: string;
  /** 媒体 URL */
  reply_url?: string;
  /** 媒体 Base64 */
  reply_base64?: string;
  /** 文件名 */
  reply_name?: string;
}

/** 工具处理函数签名 */
export type ToolHandler = (ctx: ToolContext) => Promise<string | ToolResult>;

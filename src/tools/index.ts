/**
 * 企业微信 Tools 注册中心
 * 汇总所有工具模块，提供统一的定义与处理函数收集
 */

import type { WecomClient } from '../wecom/client.js';
import type { ToolDefinition, ToolHandler } from '../hub/types.js';
import { messagingTools } from './messaging.js';
import { contactsTools } from './contacts.js';
import { calendarTools } from './calendar.js';
import { approvalTools } from './approval.js';
import { checkinTools } from './checkin.js';
import { driveTools } from './drive.js';
import { customerTools } from './customer.js';

/** 工具模块接口 */
interface ToolModule {
  definitions: ToolDefinition[];
  createHandlers: (client: WecomClient) => Map<string, ToolHandler>;
}

/** 所有工具模块列表 */
const allModules: ToolModule[] = [
  messagingTools,
  contactsTools,
  calendarTools,
  approvalTools,
  checkinTools,
  driveTools,
  customerTools,
];

/**
 * 收集所有工具的定义与处理函数
 * @param client 企业微信客户端实例
 * @returns 包含所有工具定义和处理函数映射的对象
 */
export function collectAllTools(client: WecomClient): {
  definitions: ToolDefinition[];
  handlers: Map<string, ToolHandler>;
} {
  const definitions: ToolDefinition[] = [];
  const handlers = new Map<string, ToolHandler>();

  for (const mod of allModules) {
    // 收集定义
    definitions.push(...mod.definitions);

    // 收集处理函数
    const modHandlers = mod.createHandlers(client);
    for (const [name, handler] of modHandlers) {
      handlers.set(name, handler);
    }
  }

  return { definitions, handlers };
}

// 重新导出各模块，方便按需引用
export { messagingTools } from './messaging.js';
export { contactsTools } from './contacts.js';
export { calendarTools } from './calendar.js';
export { approvalTools } from './approval.js';
export { checkinTools } from './checkin.js';
export { driveTools } from './drive.js';
export { customerTools } from './customer.js';

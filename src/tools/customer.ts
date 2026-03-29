/**
 * 企业微信外部联系人工具模块
 * 包含：列外部联系人、查外部联系人详情
 */

import type { WecomClient } from '../wecom/client.js';

/** 工具定义 */
interface ToolDefinition {
  name: string;
  description: string;
  command: string;
  parameters?: Record<string, unknown>[];
}

/** 工具上下文 */
interface ToolContext {
  installationId: string;
  botId: string;
  userId: string;
  traceId: string;
  args: Record<string, any>;
}

/** 工具处理函数 */
type ToolHandler = (ctx: ToolContext) => Promise<string>;

/** 工具模块接口 */
interface ToolModule {
  definitions: ToolDefinition[];
  createHandlers: (client: WecomClient) => Map<string, ToolHandler>;
}

/** 企业微信 OpenAPI 基础地址 */
const BASE_URL = 'https://qyapi.weixin.qq.com';

/** 超时时间 30 秒 */
const TIMEOUT_MS = 30_000;

/**
 * 带超时的 GET 请求封装
 */
async function fetchGet(url: string): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export const customerTools: ToolModule = {
  definitions: [
    {
      name: 'list_external_contacts',
      description: '列出成员的外部联系人列表',
      command: 'list_external_contacts',
      parameters: [
        { name: 'user_id', type: 'string', description: '企业微信成员ID', required: true },
      ],
    },
    {
      name: 'get_external_contact',
      description: '查询外部联系人详情',
      command: 'get_external_contact',
      parameters: [
        { name: 'external_userid', type: 'string', description: '外部联系人的UserID', required: true },
      ],
    },
  ],

  createHandlers(client: WecomClient): Map<string, ToolHandler> {
    const handlers = new Map<string, ToolHandler>();

    // 列外部联系人
    handlers.set('list_external_contacts', async (ctx) => {
      try {
        const { user_id } = ctx.args;
        if (!user_id) {
          return '参数错误：user_id 为必填项';
        }
        const token = await client.getAccessToken();
        const url = `${BASE_URL}/cgi-bin/externalcontact/list?access_token=${token}&userid=${encodeURIComponent(user_id)}`;
        const data = await fetchGet(url);
        if (data.errcode && data.errcode !== 0) {
          return `获取外部联系人列表失败：[${data.errcode}] ${data.errmsg}`;
        }
        const externalUsers = data.external_userid ?? [];
        if (externalUsers.length === 0) {
          return `成员 ${user_id} 暂无外部联系人`;
        }
        const lines = externalUsers.map((id: string) => `- ${id}`);
        return `成员 ${user_id} 共有 ${externalUsers.length} 位外部联系人：\n${lines.join('\n')}`;
      } catch (err: any) {
        return `获取外部联系人列表失败：${err.message ?? String(err)}`;
      }
    });

    // 查外部联系人详情
    handlers.set('get_external_contact', async (ctx) => {
      try {
        const { external_userid } = ctx.args;
        if (!external_userid) {
          return '参数错误：external_userid 为必填项';
        }
        const token = await client.getAccessToken();
        const url = `${BASE_URL}/cgi-bin/externalcontact/get?access_token=${token}&external_userid=${encodeURIComponent(external_userid)}`;
        const data = await fetchGet(url);
        if (data.errcode && data.errcode !== 0) {
          return `获取外部联系人详情失败：[${data.errcode}] ${data.errmsg}`;
        }
        const contact = data.external_contact;
        if (!contact) {
          return '未查询到该外部联系人信息';
        }
        const lines = [
          `姓名：${contact.name ?? '未知'}`,
          `外部UserID：${contact.external_userid ?? '未知'}`,
          `类型：${contact.type === 1 ? '微信用户' : contact.type === 2 ? '企业微信用户' : '未知'}`,
          `企业名称：${contact.corp_name ?? '无'}`,
          `职务：${contact.position ?? '无'}`,
        ];
        // 跟进人信息
        const followUsers = data.follow_user ?? [];
        if (followUsers.length > 0) {
          lines.push('跟进人：');
          for (const fu of followUsers) {
            const tags = (fu.tags ?? []).map((t: any) => t.tag_name).join('、');
            lines.push(
              `  - ${fu.userid}（添加时间：${fu.createtime ? new Date(fu.createtime * 1000).toLocaleString('zh-CN') : '未知'}${tags ? `，标签：${tags}` : ''}）`,
            );
          }
        }
        return lines.join('\n');
      } catch (err: any) {
        return `获取外部联系人详情失败：${err.message ?? String(err)}`;
      }
    });

    return handlers;
  },
};

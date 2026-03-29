/**
 * 企业微信消息发送工具模块
 * 包含：发应用消息、Markdown、模板卡片、图文消息
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

export const messagingTools: ToolModule = {
  definitions: [
    {
      name: 'send_wecom_message',
      description: '发送企业微信应用文本消息',
      command: 'send_wecom_message',
      parameters: [
        { name: 'to_user', type: 'string', description: '接收消息的成员ID', required: true },
        { name: 'text', type: 'string', description: '消息内容', required: true },
      ],
    },
    {
      name: 'send_wecom_markdown',
      description: '发送企业微信 Markdown 消息',
      command: 'send_wecom_markdown',
      parameters: [
        { name: 'to_user', type: 'string', description: '接收消息的成员ID', required: true },
        { name: 'title', type: 'string', description: '消息标题', required: true },
        { name: 'content', type: 'string', description: 'Markdown 内容', required: true },
      ],
    },
    {
      name: 'send_wecom_card',
      description: '发送企业微信模板卡片消息',
      command: 'send_wecom_card',
      parameters: [
        { name: 'to_user', type: 'string', description: '接收消息的成员ID', required: true },
        { name: 'title', type: 'string', description: '卡片标题', required: true },
        { name: 'description', type: 'string', description: '卡片描述', required: true },
        { name: 'url', type: 'string', description: '跳转链接', required: true },
      ],
    },
    {
      name: 'send_wecom_news',
      description: '发送企业微信图文消息',
      command: 'send_wecom_news',
      parameters: [
        { name: 'to_user', type: 'string', description: '接收消息的成员ID', required: true },
        { name: 'title', type: 'string', description: '图文标题', required: true },
        { name: 'description', type: 'string', description: '图文描述', required: true },
        { name: 'url', type: 'string', description: '跳转链接', required: true },
        { name: 'pic_url', type: 'string', description: '封面图片链接（可选）', required: false },
      ],
    },
  ],

  createHandlers(client: WecomClient): Map<string, ToolHandler> {
    const handlers = new Map<string, ToolHandler>();

    // 发送文本消息
    handlers.set('send_wecom_message', async (ctx) => {
      try {
        const { to_user, text } = ctx.args;
        if (!to_user || !text) {
          return '参数错误：to_user 和 text 为必填项';
        }
        await client.sendText(to_user, text);
        return `已成功向 ${to_user} 发送文本消息`;
      } catch (err: any) {
        return `发送文本消息失败：${err.message ?? String(err)}`;
      }
    });

    // 发送 Markdown 消息
    handlers.set('send_wecom_markdown', async (ctx) => {
      try {
        const { to_user, title, content } = ctx.args;
        if (!to_user || !title || !content) {
          return '参数错误：to_user、title 和 content 为必填项';
        }
        await client.sendMarkdown(to_user, title, content);
        return `已成功向 ${to_user} 发送 Markdown 消息`;
      } catch (err: any) {
        return `发送 Markdown 消息失败：${err.message ?? String(err)}`;
      }
    });

    // 发送模板卡片消息
    handlers.set('send_wecom_card', async (ctx) => {
      try {
        const { to_user, title, description, url } = ctx.args;
        if (!to_user || !title || !description || !url) {
          return '参数错误：to_user、title、description 和 url 为必填项';
        }
        const cardContent = {
          card_type: 'text_notice',
          main_title: { title, desc: description },
          card_action: { type: 1, url },
        };
        await client.sendAppMessage(to_user, 'template_card', cardContent);
        return `已成功向 ${to_user} 发送模板卡片消息`;
      } catch (err: any) {
        return `发送模板卡片消息失败：${err.message ?? String(err)}`;
      }
    });

    // 发送图文消息
    handlers.set('send_wecom_news', async (ctx) => {
      try {
        const { to_user, title, description, url, pic_url } = ctx.args;
        if (!to_user || !title || !description || !url) {
          return '参数错误：to_user、title、description 和 url 为必填项';
        }
        const newsContent = {
          articles: [
            {
              title,
              description,
              url,
              picurl: pic_url || '',
            },
          ],
        };
        await client.sendAppMessage(to_user, 'news', newsContent);
        return `已成功向 ${to_user} 发送图文消息`;
      } catch (err: any) {
        return `发送图文消息失败：${err.message ?? String(err)}`;
      }
    });

    return handlers;
  },
};

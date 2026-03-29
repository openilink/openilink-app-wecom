/**
 * 企业微信微盘工具模块
 * 包含：列微盘空间、列空间文件
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
 * 带超时的 POST 请求封装
 */
async function fetchPost(url: string, body: unknown): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export const driveTools: ToolModule = {
  definitions: [
    {
      name: 'list_spaces',
      description: '列出企业微信微盘空间列表',
      command: 'list_spaces',
    },
    {
      name: 'list_files',
      description: '列出企业微信微盘空间中的文件',
      command: 'list_files',
      parameters: [
        { name: 'space_id', type: 'string', description: '微盘空间ID', required: true },
      ],
    },
  ],

  createHandlers(client: WecomClient): Map<string, ToolHandler> {
    const handlers = new Map<string, ToolHandler>();

    // 列微盘空间
    handlers.set('list_spaces', async (ctx) => {
      try {
        const token = await client.getAccessToken();
        const url = `${BASE_URL}/cgi-bin/wedrive/space_list?access_token=${token}`;
        const body = {};
        const data = await fetchPost(url, body);
        if (data.errcode && data.errcode !== 0) {
          return `获取微盘空间列表失败：[${data.errcode}] ${data.errmsg}`;
        }
        const spaces = data.space_list ?? [];
        if (spaces.length === 0) {
          return '暂无微盘空间';
        }
        const lines = spaces.map(
          (s: any) => `- [${s.spaceid}] ${s.space_name ?? '未命名'}（类型：${s.space_type === 1 ? '个人' : '共享'}）`,
        );
        return `共 ${spaces.length} 个微盘空间：\n${lines.join('\n')}`;
      } catch (err: any) {
        return `获取微盘空间列表失败：${err.message ?? String(err)}`;
      }
    });

    // 列空间文件
    handlers.set('list_files', async (ctx) => {
      try {
        const { space_id } = ctx.args;
        if (!space_id) {
          return '参数错误：space_id 为必填项';
        }
        const token = await client.getAccessToken();
        const url = `${BASE_URL}/cgi-bin/wedrive/file_list?access_token=${token}`;
        const body = { spaceid: space_id };
        const data = await fetchPost(url, body);
        if (data.errcode && data.errcode !== 0) {
          return `获取文件列表失败：[${data.errcode}] ${data.errmsg}`;
        }
        const files = data.file_list?.files ?? [];
        if (files.length === 0) {
          return '该空间暂无文件';
        }
        const lines = files.map((f: any) => {
          const typeText = f.file_type === 1 ? '文件夹' : '文件';
          return `- [${typeText}] ${f.file_name ?? '未命名'}（ID：${f.fileid ?? '未知'}）`;
        });
        return `共 ${files.length} 个文件/文件夹：\n${lines.join('\n')}`;
      } catch (err: any) {
        return `获取文件列表失败：${err.message ?? String(err)}`;
      }
    });

    return handlers;
  },
};

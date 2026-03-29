/**
 * 企业微信通讯录工具模块
 * 包含：获取成员信息、列部门成员、列部门
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

export const contactsTools: ToolModule = {
  definitions: [
    {
      name: 'get_user_info',
      description: '获取企业微信成员详细信息',
      command: 'get_user_info',
      parameters: [
        { name: 'user_id', type: 'string', description: '成员ID', required: true },
      ],
    },
    {
      name: 'list_department_users',
      description: '获取部门成员列表',
      command: 'list_department_users',
      parameters: [
        { name: 'department_id', type: 'string', description: '部门ID，默认为1（根部门）', required: false },
      ],
    },
    {
      name: 'list_departments',
      description: '获取部门列表',
      command: 'list_departments',
      parameters: [
        { name: 'parent_id', type: 'string', description: '父部门ID（可选，不填则获取全部）', required: false },
      ],
    },
  ],

  createHandlers(client: WecomClient): Map<string, ToolHandler> {
    const handlers = new Map<string, ToolHandler>();

    // 获取成员信息
    handlers.set('get_user_info', async (ctx) => {
      try {
        const { user_id } = ctx.args;
        if (!user_id) {
          return '参数错误：user_id 为必填项';
        }
        const token = await client.getAccessToken();
        const url = `${BASE_URL}/cgi-bin/user/get?access_token=${token}&userid=${encodeURIComponent(user_id)}`;
        const data = await fetchGet(url);
        if (data.errcode && data.errcode !== 0) {
          return `获取成员信息失败：[${data.errcode}] ${data.errmsg}`;
        }
        return `成员信息：\n姓名：${data.name ?? '未知'}\n用户ID：${data.userid}\n部门：${JSON.stringify(data.department ?? [])}\n职务：${data.position ?? '无'}\n手机：${data.mobile ?? '未填写'}\n邮箱：${data.email ?? '未填写'}\n状态：${data.status === 1 ? '已激活' : data.status === 2 ? '已禁用' : data.status === 4 ? '未激活' : '未知'}`;
      } catch (err: any) {
        return `获取成员信息失败：${err.message ?? String(err)}`;
      }
    });

    // 列部门成员
    handlers.set('list_department_users', async (ctx) => {
      try {
        const departmentId = ctx.args.department_id || '1';
        const token = await client.getAccessToken();
        const url = `${BASE_URL}/cgi-bin/user/simplelist?access_token=${token}&department_id=${encodeURIComponent(departmentId)}`;
        const data = await fetchGet(url);
        if (data.errcode && data.errcode !== 0) {
          return `获取部门成员列表失败：[${data.errcode}] ${data.errmsg}`;
        }
        const users = data.userlist ?? [];
        if (users.length === 0) {
          return `部门 ${departmentId} 下暂无成员`;
        }
        const lines = users.map((u: any) => `- ${u.name}（${u.userid}）`);
        return `部门 ${departmentId} 共 ${users.length} 位成员：\n${lines.join('\n')}`;
      } catch (err: any) {
        return `获取部门成员列表失败：${err.message ?? String(err)}`;
      }
    });

    // 列部门
    handlers.set('list_departments', async (ctx) => {
      try {
        const token = await client.getAccessToken();
        let url = `${BASE_URL}/cgi-bin/department/list?access_token=${token}`;
        if (ctx.args.parent_id) {
          url += `&id=${encodeURIComponent(ctx.args.parent_id)}`;
        }
        const data = await fetchGet(url);
        if (data.errcode && data.errcode !== 0) {
          return `获取部门列表失败：[${data.errcode}] ${data.errmsg}`;
        }
        const departments = data.department ?? [];
        if (departments.length === 0) {
          return '暂无部门数据';
        }
        const lines = departments.map(
          (d: any) => `- [${d.id}] ${d.name}（上级部门：${d.parentid ?? '无'}）`,
        );
        return `共 ${departments.length} 个部门：\n${lines.join('\n')}`;
      } catch (err: any) {
        return `获取部门列表失败：${err.message ?? String(err)}`;
      }
    });

    return handlers;
  },
};

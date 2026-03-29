/**
 * 企业微信打卡工具模块
 * 包含：查打卡记录、查打卡规则
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

/** 打卡类型映射 */
function checkinTypeText(type: string): string {
  const map: Record<string, string> = {
    上班打卡: '上班打卡',
    下班打卡: '下班打卡',
  };
  return map[type] ?? type;
}

/** 异常类型映射 */
function exceptionTypeText(types: string[]): string {
  if (!types || types.length === 0) return '正常';
  return types.join('、');
}

export const checkinTools: ToolModule = {
  definitions: [
    {
      name: 'get_checkin_data',
      description: '查询企业微信打卡记录',
      command: 'get_checkin_data',
      parameters: [
        { name: 'user_ids', type: 'string', description: '成员ID列表，逗号分隔', required: true },
        { name: 'start_time', type: 'string', description: '开始时间（Unix 时间戳）', required: true },
        { name: 'end_time', type: 'string', description: '结束时间（Unix 时间戳）', required: true },
      ],
    },
    {
      name: 'get_checkin_rules',
      description: '查询企业微信打卡规则',
      command: 'get_checkin_rules',
      parameters: [
        { name: 'user_ids', type: 'string', description: '成员ID列表，逗号分隔', required: true },
      ],
    },
  ],

  createHandlers(client: WecomClient): Map<string, ToolHandler> {
    const handlers = new Map<string, ToolHandler>();

    // 查打卡记录
    handlers.set('get_checkin_data', async (ctx) => {
      try {
        const { user_ids, start_time, end_time } = ctx.args;
        if (!user_ids || !start_time || !end_time) {
          return '参数错误：user_ids、start_time 和 end_time 为必填项';
        }
        const token = await client.getAccessToken();
        const url = `${BASE_URL}/cgi-bin/checkin/getcheckindata?access_token=${token}`;
        const userList = user_ids.split(',').map((id: string) => id.trim());
        const body = {
          opencheckindatatype: 3, // 3 = 全部打卡数据
          starttime: Number(start_time),
          endtime: Number(end_time),
          useridlist: userList,
        };
        const data = await fetchPost(url, body);
        if (data.errcode && data.errcode !== 0) {
          return `查询打卡记录失败：[${data.errcode}] ${data.errmsg}`;
        }
        const checkinData = data.checkindata ?? [];
        if (checkinData.length === 0) {
          return '该时间范围内暂无打卡记录';
        }
        const lines = checkinData.map((item: any) => {
          const time = item.checkin_time
            ? new Date(item.checkin_time * 1000).toLocaleString('zh-CN')
            : '未知';
          return `- ${item.userid}：${checkinTypeText(item.checkin_type ?? '')} ${time}，${exceptionTypeText(item.exception_type ?? [])}`;
        });
        return `共 ${checkinData.length} 条打卡记录：\n${lines.join('\n')}`;
      } catch (err: any) {
        return `查询打卡记录失败：${err.message ?? String(err)}`;
      }
    });

    // 查打卡规则
    handlers.set('get_checkin_rules', async (ctx) => {
      try {
        const { user_ids } = ctx.args;
        if (!user_ids) {
          return '参数错误：user_ids 为必填项';
        }
        const token = await client.getAccessToken();
        const url = `${BASE_URL}/cgi-bin/checkin/getcorpcheckinoption?access_token=${token}`;
        const userList = user_ids.split(',').map((id: string) => id.trim());
        const body = { userid: userList };
        const data = await fetchPost(url, body);
        if (data.errcode && data.errcode !== 0) {
          return `查询打卡规则失败：[${data.errcode}] ${data.errmsg}`;
        }
        const groups = data.group ?? [];
        if (groups.length === 0) {
          return '暂无打卡规则数据';
        }
        const lines = groups.map((g: any) => {
          const checkinTime = g.checkintime ?? [];
          const timeInfo = checkinTime
            .map((t: any) => `${t.work_sec ?? '?'}~${t.off_work_sec ?? '?'}`)
            .join(', ');
          return `- 规则名称：${g.groupname ?? '未知'}，打卡时间：${timeInfo || '未设置'}`;
        });
        return `共 ${groups.length} 条打卡规则：\n${lines.join('\n')}`;
      } catch (err: any) {
        return `查询打卡规则失败：${err.message ?? String(err)}`;
      }
    });

    return handlers;
  },
};

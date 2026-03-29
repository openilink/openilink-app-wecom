/**
 * 企业微信日程工具模块
 * 包含：查看日程、创建日程、查忙闲
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

export const calendarTools: ToolModule = {
  definitions: [
    {
      name: 'list_schedule',
      description: '查看指定成员在时间范围内的日程',
      command: 'list_schedule',
      parameters: [
        { name: 'user_ids', type: 'string', description: '成员ID列表，逗号分隔', required: true },
        { name: 'start_time', type: 'string', description: '开始时间（Unix 时间戳）', required: true },
        { name: 'end_time', type: 'string', description: '结束时间（Unix 时间戳）', required: true },
      ],
    },
    {
      name: 'create_schedule',
      description: '创建企业微信日程',
      command: 'create_schedule',
      parameters: [
        { name: 'summary', type: 'string', description: '日程主题', required: true },
        { name: 'start_time', type: 'string', description: '开始时间（Unix 时间戳）', required: true },
        { name: 'end_time', type: 'string', description: '结束时间（Unix 时间戳）', required: true },
        { name: 'attendees', type: 'string', description: '参与人ID列表，逗号分隔（可选）', required: false },
      ],
    },
    {
      name: 'get_free_busy',
      description: '查询成员忙闲状态',
      command: 'get_free_busy',
      parameters: [
        { name: 'user_ids', type: 'string', description: '成员ID列表，逗号分隔', required: true },
        { name: 'start_time', type: 'string', description: '开始时间（Unix 时间戳）', required: true },
        { name: 'end_time', type: 'string', description: '结束时间（Unix 时间戳）', required: true },
      ],
    },
  ],

  createHandlers(client: WecomClient): Map<string, ToolHandler> {
    const handlers = new Map<string, ToolHandler>();

    // 查看日程
    handlers.set('list_schedule', async (ctx) => {
      try {
        const { user_ids, start_time, end_time } = ctx.args;
        if (!user_ids || !start_time || !end_time) {
          return '参数错误：user_ids、start_time 和 end_time 为必填项';
        }
        const token = await client.getAccessToken();
        const url = `${BASE_URL}/cgi-bin/oa/schedule/get_by_calendar?access_token=${token}`;
        const userList = user_ids.split(',').map((id: string) => id.trim());
        const body = {
          userid_list: userList,
          start_time: Number(start_time),
          end_time: Number(end_time),
        };
        const data = await fetchPost(url, body);
        if (data.errcode && data.errcode !== 0) {
          return `查询日程失败：[${data.errcode}] ${data.errmsg}`;
        }
        const scheduleList = data.schedule_list ?? [];
        if (scheduleList.length === 0) {
          return '该时间范围内暂无日程';
        }
        const lines = scheduleList.map((s: any) => {
          const schedule = s.schedule ?? s;
          return `- ${schedule.summary ?? '无主题'}（${schedule.start_time ?? '?'} ~ ${schedule.end_time ?? '?'}）`;
        });
        return `共 ${scheduleList.length} 条日程：\n${lines.join('\n')}`;
      } catch (err: any) {
        return `查询日程失败：${err.message ?? String(err)}`;
      }
    });

    // 创建日程
    handlers.set('create_schedule', async (ctx) => {
      try {
        const { summary, start_time, end_time, attendees } = ctx.args;
        if (!summary || !start_time || !end_time) {
          return '参数错误：summary、start_time 和 end_time 为必填项';
        }
        const token = await client.getAccessToken();
        const url = `${BASE_URL}/cgi-bin/oa/schedule/add?access_token=${token}`;
        const schedule: any = {
          summary,
          start_time: Number(start_time),
          end_time: Number(end_time),
        };
        if (attendees) {
          schedule.attendees = attendees
            .split(',')
            .map((id: string) => ({ userid: id.trim() }));
        }
        const body = { schedule };
        const data = await fetchPost(url, body);
        if (data.errcode && data.errcode !== 0) {
          return `创建日程失败：[${data.errcode}] ${data.errmsg}`;
        }
        return `日程创建成功，日程ID：${data.schedule_id ?? '未知'}`;
      } catch (err: any) {
        return `创建日程失败：${err.message ?? String(err)}`;
      }
    });

    // 查忙闲
    handlers.set('get_free_busy', async (ctx) => {
      try {
        const { user_ids, start_time, end_time } = ctx.args;
        if (!user_ids || !start_time || !end_time) {
          return '参数错误：user_ids、start_time 和 end_time 为必填项';
        }
        const token = await client.getAccessToken();
        const url = `${BASE_URL}/cgi-bin/oa/schedule/get_by_calendar?access_token=${token}`;
        const userList = user_ids.split(',').map((id: string) => id.trim());
        const body = {
          userid_list: userList,
          start_time: Number(start_time),
          end_time: Number(end_time),
        };
        const data = await fetchPost(url, body);
        if (data.errcode && data.errcode !== 0) {
          return `查询忙闲失败：[${data.errcode}] ${data.errmsg}`;
        }
        const scheduleList = data.schedule_list ?? [];
        if (scheduleList.length === 0) {
          return '该时间范围内所有成员空闲';
        }
        // 按用户聚合忙闲信息
        const busyMap = new Map<string, string[]>();
        for (const item of scheduleList) {
          const schedule = item.schedule ?? item;
          const organizer = schedule.organizer ?? '未知';
          if (!busyMap.has(organizer)) {
            busyMap.set(organizer, []);
          }
          busyMap.get(organizer)!.push(
            `${schedule.summary ?? '无主题'}（${schedule.start_time ?? '?'} ~ ${schedule.end_time ?? '?'}）`,
          );
        }
        const lines: string[] = [];
        for (const [userId, schedules] of busyMap) {
          lines.push(`${userId}：`);
          for (const s of schedules) {
            lines.push(`  - ${s}`);
          }
        }
        return `忙闲查询结果：\n${lines.join('\n')}`;
      } catch (err: any) {
        return `查询忙闲失败：${err.message ?? String(err)}`;
      }
    });

    return handlers;
  },
};

/**
 * 企业微信审批工具模块
 * 包含：查审批列表、查审批详情
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

/** 审批状态码映射 */
function approvalStatusText(status: number): string {
  const map: Record<number, string> = {
    1: '审批中',
    2: '已通过',
    3: '已驳回',
    4: '已撤销',
    6: '通过后撤销',
    7: '已删除',
  };
  return map[status] ?? `未知(${status})`;
}

export const approvalTools: ToolModule = {
  definitions: [
    {
      name: 'list_approvals',
      description: '查询企业微信审批列表',
      command: 'list_approvals',
      parameters: [
        { name: 'start_time', type: 'string', description: '开始时间（Unix 时间戳）', required: true },
        { name: 'end_time', type: 'string', description: '结束时间（Unix 时间戳）', required: true },
      ],
    },
    {
      name: 'get_approval_detail',
      description: '查询企业微信审批单详情',
      command: 'get_approval_detail',
      parameters: [
        { name: 'sp_no', type: 'string', description: '审批单号', required: true },
      ],
    },
  ],

  createHandlers(client: WecomClient): Map<string, ToolHandler> {
    const handlers = new Map<string, ToolHandler>();

    // 查审批列表
    handlers.set('list_approvals', async (ctx) => {
      try {
        const { start_time, end_time } = ctx.args;
        if (!start_time || !end_time) {
          return '参数错误：start_time 和 end_time 为必填项';
        }
        const token = await client.getAccessToken();
        const url = `${BASE_URL}/cgi-bin/oa/getapprovalinfo?access_token=${token}`;
        const body = {
          starttime: Number(start_time),
          endtime: Number(end_time),
          new_cursor: 0,
          size: 100,
        };
        const data = await fetchPost(url, body);
        if (data.errcode && data.errcode !== 0) {
          return `查询审批列表失败：[${data.errcode}] ${data.errmsg}`;
        }
        const spList = data.sp_no_list ?? [];
        if (spList.length === 0) {
          return '该时间范围内暂无审批记录';
        }
        const lines = spList.map((spNo: string) => `- 审批单号：${spNo}`);
        return `共 ${spList.length} 条审批记录：\n${lines.join('\n')}`;
      } catch (err: any) {
        return `查询审批列表失败：${err.message ?? String(err)}`;
      }
    });

    // 查审批详情
    handlers.set('get_approval_detail', async (ctx) => {
      try {
        const { sp_no } = ctx.args;
        if (!sp_no) {
          return '参数错误：sp_no（审批单号）为必填项';
        }
        const token = await client.getAccessToken();
        const url = `${BASE_URL}/cgi-bin/oa/getapprovaldetail?access_token=${token}`;
        const body = { sp_no };
        const data = await fetchPost(url, body);
        if (data.errcode && data.errcode !== 0) {
          return `查询审批详情失败：[${data.errcode}] ${data.errmsg}`;
        }
        const info = data.info;
        if (!info) {
          return '未查询到该审批单详情';
        }
        const lines = [
          `审批单号：${info.sp_no}`,
          `审批名称：${info.sp_name ?? '未知'}`,
          `状态：${approvalStatusText(info.sp_status)}`,
          `申请人：${info.applyer?.userid ?? '未知'}`,
          `申请时间：${info.apply_time ?? '未知'}`,
        ];
        // 审批节点信息
        const spRecords = info.sp_record ?? [];
        if (spRecords.length > 0) {
          lines.push('审批节点：');
          for (const record of spRecords) {
            const details = record.details ?? [];
            for (const d of details) {
              lines.push(
                `  - 审批人：${d.approver?.userid ?? '未知'}，状态：${approvalStatusText(d.sp_status)}`,
              );
            }
          }
        }
        return lines.join('\n');
      } catch (err: any) {
        return `查询审批详情失败：${err.message ?? String(err)}`;
      }
    });

    return handlers;
  },
};

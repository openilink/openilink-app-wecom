import { describe, it, expect, vi, afterEach } from "vitest";
import { approvalTools } from "../../src/tools/approval.js";

/** 构造模拟的 WecomClient */
function mockWecomClient() {
  return {
    start: vi.fn(),
    stop: vi.fn(),
    getWSClient: vi.fn(),
    replyStream: vi.fn(),
    getAccessToken: vi.fn().mockResolvedValue("mock-token"),
    sendAppMessage: vi.fn(),
    sendText: vi.fn(),
    sendMarkdown: vi.fn(),
  } as any;
}

/** 标准工具上下文 */
const baseCtx = {
  installationId: "inst-1",
  botId: "bot-1",
  userId: "user-1",
  traceId: "trace-1",
};

describe("approvalTools", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe("definitions", () => {
    it("定义了 2 个工具", () => {
      expect(approvalTools.definitions.length).toBe(2);
    });

    it("包含 list_approvals 和 get_approval_detail", () => {
      const names = approvalTools.definitions.map((t) => t.name);
      expect(names).toContain("list_approvals");
      expect(names).toContain("get_approval_detail");
    });
  });

  describe("handlers", () => {
    it("list_approvals 缺少参数返回错误", async () => {
      const client = mockWecomClient();
      const handlers = approvalTools.createHandlers(client);
      const handler = handlers.get("list_approvals")!;

      const result = await handler({ ...baseCtx, args: {} });
      expect(result).toContain("参数错误");
    });

    it("list_approvals 返回审批记录列表", async () => {
      const client = mockWecomClient();
      globalThis.fetch = vi.fn().mockResolvedValue({
        json: () =>
          Promise.resolve({
            errcode: 0,
            sp_no_list: ["2025030001", "2025030002"],
          }),
      }) as any;

      const handlers = approvalTools.createHandlers(client);
      const handler = handlers.get("list_approvals")!;

      const result = await handler({
        ...baseCtx,
        args: { start_time: "1700000000", end_time: "1700100000" },
      });
      expect(result).toContain("2 条审批记录");
      expect(result).toContain("2025030001");
    });

    it("list_approvals 无记录时提示暂无", async () => {
      const client = mockWecomClient();
      globalThis.fetch = vi.fn().mockResolvedValue({
        json: () =>
          Promise.resolve({
            errcode: 0,
            sp_no_list: [],
          }),
      }) as any;

      const handlers = approvalTools.createHandlers(client);
      const handler = handlers.get("list_approvals")!;

      const result = await handler({
        ...baseCtx,
        args: { start_time: "1700000000", end_time: "1700100000" },
      });
      expect(result).toContain("暂无审批记录");
    });

    it("get_approval_detail 缺少 sp_no 返回错误", async () => {
      const client = mockWecomClient();
      const handlers = approvalTools.createHandlers(client);
      const handler = handlers.get("get_approval_detail")!;

      const result = await handler({ ...baseCtx, args: {} });
      expect(result).toContain("参数错误");
    });

    it("get_approval_detail 返回审批详情", async () => {
      const client = mockWecomClient();
      globalThis.fetch = vi.fn().mockResolvedValue({
        json: () =>
          Promise.resolve({
            errcode: 0,
            info: {
              sp_no: "2025030001",
              sp_name: "请假申请",
              sp_status: 2,
              applyer: { userid: "zhangsan" },
              apply_time: "1700000000",
              sp_record: [
                {
                  details: [
                    { approver: { userid: "lisi" }, sp_status: 2 },
                  ],
                },
              ],
            },
          }),
      }) as any;

      const handlers = approvalTools.createHandlers(client);
      const handler = handlers.get("get_approval_detail")!;

      const result = await handler({
        ...baseCtx,
        args: { sp_no: "2025030001" },
      });
      expect(result).toContain("2025030001");
      expect(result).toContain("请假申请");
      expect(result).toContain("已通过");
    });

    it("API 返回错误码时提示失败", async () => {
      const client = mockWecomClient();
      globalThis.fetch = vi.fn().mockResolvedValue({
        json: () =>
          Promise.resolve({
            errcode: 40001,
            errmsg: "invalid credential",
          }),
      }) as any;

      const handlers = approvalTools.createHandlers(client);
      const handler = handlers.get("list_approvals")!;

      const result = await handler({
        ...baseCtx,
        args: { start_time: "1700000000", end_time: "1700100000" },
      });
      expect(result).toContain("失败");
      expect(result).toContain("40001");
    });
  });
});

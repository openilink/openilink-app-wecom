import { describe, it, expect, vi, afterEach } from "vitest";
import { contactsTools } from "../../src/tools/contacts.js";

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

describe("contactsTools", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe("definitions", () => {
    it("定义了 3 个工具", () => {
      expect(contactsTools.definitions.length).toBe(3);
    });

    it("包含 get_user_info、list_department_users、list_departments", () => {
      const names = contactsTools.definitions.map((t) => t.name);
      expect(names).toContain("get_user_info");
      expect(names).toContain("list_department_users");
      expect(names).toContain("list_departments");
    });
  });

  describe("handlers", () => {
    it("get_user_info 缺少 user_id 返回错误", async () => {
      const client = mockWecomClient();
      const handlers = contactsTools.createHandlers(client);
      const handler = handlers.get("get_user_info")!;

      const result = await handler({ ...baseCtx, args: {} });
      expect(result).toContain("参数错误");
    });

    it("get_user_info 成功返回成员信息", async () => {
      const client = mockWecomClient();
      globalThis.fetch = vi.fn().mockResolvedValue({
        json: () =>
          Promise.resolve({
            errcode: 0,
            name: "张三",
            userid: "zhangsan",
            department: [1, 2],
            position: "工程师",
            mobile: "13800138000",
            email: "zhangsan@example.com",
            status: 1,
          }),
      }) as any;

      const handlers = contactsTools.createHandlers(client);
      const handler = handlers.get("get_user_info")!;

      const result = await handler({
        ...baseCtx,
        args: { user_id: "zhangsan" },
      });
      expect(result).toContain("张三");
      expect(result).toContain("已激活");
    });

    it("get_user_info API 返回错误码时提示失败", async () => {
      const client = mockWecomClient();
      globalThis.fetch = vi.fn().mockResolvedValue({
        json: () =>
          Promise.resolve({
            errcode: 60111,
            errmsg: "userid not found",
          }),
      }) as any;

      const handlers = contactsTools.createHandlers(client);
      const handler = handlers.get("get_user_info")!;

      const result = await handler({
        ...baseCtx,
        args: { user_id: "not-exist" },
      });
      expect(result).toContain("失败");
      expect(result).toContain("60111");
    });

    it("list_department_users 默认使用部门 1", async () => {
      const client = mockWecomClient();
      globalThis.fetch = vi.fn().mockResolvedValue({
        json: () =>
          Promise.resolve({
            errcode: 0,
            userlist: [
              { name: "张三", userid: "zhangsan" },
              { name: "李四", userid: "lisi" },
            ],
          }),
      }) as any;

      const handlers = contactsTools.createHandlers(client);
      const handler = handlers.get("list_department_users")!;

      const result = await handler({ ...baseCtx, args: {} });
      expect(result).toContain("2 位成员");
      expect(result).toContain("张三");

      /** 验证 URL 中使用了部门 1 */
      const url = vi.mocked(globalThis.fetch).mock.calls[0][0] as string;
      expect(url).toContain("department_id=1");
    });

    it("list_departments 返回部门列表", async () => {
      const client = mockWecomClient();
      globalThis.fetch = vi.fn().mockResolvedValue({
        json: () =>
          Promise.resolve({
            errcode: 0,
            department: [
              { id: 1, name: "公司", parentid: 0 },
              { id: 2, name: "技术部", parentid: 1 },
            ],
          }),
      }) as any;

      const handlers = contactsTools.createHandlers(client);
      const handler = handlers.get("list_departments")!;

      const result = await handler({ ...baseCtx, args: {} });
      expect(result).toContain("2 个部门");
      expect(result).toContain("技术部");
    });
  });
});

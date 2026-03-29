import { describe, it, expect, vi } from "vitest";
import { messagingTools } from "../../src/tools/messaging.js";

/** 构造模拟的 WecomClient */
function mockWecomClient() {
  return {
    start: vi.fn(),
    stop: vi.fn(),
    getWSClient: vi.fn(),
    replyStream: vi.fn(),
    replyCard: vi.fn(),
    getAccessToken: vi.fn().mockResolvedValue("mock-token"),
    sendAppMessage: vi.fn().mockResolvedValue(undefined),
    sendText: vi.fn().mockResolvedValue(undefined),
    sendMarkdown: vi.fn().mockResolvedValue(undefined),
  } as any;
}

/** 标准工具上下文 */
const baseCtx = {
  installationId: "inst-1",
  botId: "bot-1",
  userId: "user-1",
  traceId: "trace-1",
};

describe("messagingTools", () => {
  describe("definitions", () => {
    it("定义了 4 个工具", () => {
      expect(messagingTools.definitions.length).toBe(4);
    });

    it("包含 send_wecom_message 工具", () => {
      const tool = messagingTools.definitions.find(
        (t) => t.name === "send_wecom_message",
      );
      expect(tool).toBeDefined();
      expect(tool!.command).toBe("send_wecom_message");
    });

    it("包含 send_wecom_markdown 工具", () => {
      const tool = messagingTools.definitions.find(
        (t) => t.name === "send_wecom_markdown",
      );
      expect(tool).toBeDefined();
    });

    it("包含 send_wecom_card 和 send_wecom_news 工具", () => {
      const names = messagingTools.definitions.map((t) => t.name);
      expect(names).toContain("send_wecom_card");
      expect(names).toContain("send_wecom_news");
    });
  });

  describe("handlers", () => {
    it("send_wecom_message 发送成功返回确认信息", async () => {
      const client = mockWecomClient();
      const handlers = messagingTools.createHandlers(client);
      const handler = handlers.get("send_wecom_message")!;

      const result = await handler({
        ...baseCtx,
        args: { to_user: "user-001", text: "你好" },
      });

      expect(result).toContain("user-001");
      expect(result).toContain("成功");
      expect(client.sendText).toHaveBeenCalledWith("user-001", "你好");
    });

    it("send_wecom_message 缺少参数返回错误提示", async () => {
      const client = mockWecomClient();
      const handlers = messagingTools.createHandlers(client);
      const handler = handlers.get("send_wecom_message")!;

      const result = await handler({
        ...baseCtx,
        args: { to_user: "user-001" },
      });

      expect(result).toContain("参数错误");
    });

    it("send_wecom_markdown 调用 client.sendMarkdown", async () => {
      const client = mockWecomClient();
      const handlers = messagingTools.createHandlers(client);
      const handler = handlers.get("send_wecom_markdown")!;

      const result = await handler({
        ...baseCtx,
        args: { to_user: "user-001", title: "标题", content: "# 正文" },
      });

      expect(result).toContain("成功");
      expect(client.sendMarkdown).toHaveBeenCalledWith("user-001", "标题", "# 正文");
    });

    it("send_wecom_card 发送模板卡片", async () => {
      const client = mockWecomClient();
      const handlers = messagingTools.createHandlers(client);
      const handler = handlers.get("send_wecom_card")!;

      const result = await handler({
        ...baseCtx,
        args: {
          to_user: "user-001",
          title: "卡片标题",
          description: "卡片描述",
          url: "https://example.com",
        },
      });

      expect(result).toContain("成功");
      expect(client.sendAppMessage).toHaveBeenCalledWith(
        "user-001",
        "template_card",
        expect.objectContaining({ card_type: "text_notice" }),
      );
    });

    it("send_wecom_news 发送图文消息", async () => {
      const client = mockWecomClient();
      const handlers = messagingTools.createHandlers(client);
      const handler = handlers.get("send_wecom_news")!;

      const result = await handler({
        ...baseCtx,
        args: {
          to_user: "user-001",
          title: "图文标题",
          description: "描述内容",
          url: "https://example.com/news",
          pic_url: "https://example.com/cover.jpg",
        },
      });

      expect(result).toContain("成功");
      expect(client.sendAppMessage).toHaveBeenCalledWith(
        "user-001",
        "news",
        expect.objectContaining({
          articles: expect.arrayContaining([
            expect.objectContaining({ title: "图文标题" }),
          ]),
        }),
      );
    });

    it("发送失败时返回错误信息", async () => {
      const client = mockWecomClient();
      client.sendText.mockRejectedValue(new Error("网络超时"));
      const handlers = messagingTools.createHandlers(client);
      const handler = handlers.get("send_wecom_message")!;

      const result = await handler({
        ...baseCtx,
        args: { to_user: "user-001", text: "你好" },
      });

      expect(result).toContain("失败");
      expect(result).toContain("网络超时");
    });
  });
});

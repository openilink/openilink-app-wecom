import { describe, it, expect, vi, beforeEach } from "vitest";
import { WxToWecom } from "../../src/bridge/wx-to-wecom.js";
import type { HubEvent, Installation } from "../../src/hub/types.js";

/** 构造模拟的 WecomClient */
function mockWecomClient() {
  return {
    start: vi.fn(),
    stop: vi.fn(),
    getWSClient: vi.fn(),
    replyStream: vi.fn(),
    replyCard: vi.fn(),
    getAccessToken: vi.fn().mockResolvedValue("mock-token"),
    sendAppMessage: vi.fn(),
    sendText: vi.fn(),
    sendMarkdown: vi.fn().mockResolvedValue(undefined),
  } as any;
}

/** 构造模拟的 Store */
function mockStore(latestLink?: any) {
  return {
    getInstallation: vi.fn(),
    getAllInstallations: vi.fn().mockReturnValue([]),
    saveInstallation: vi.fn(),
    saveMessageLink: vi.fn(),
    getMessageLinkByWecomMsg: vi.fn(),
    getLatestLinkByWxUser: vi.fn().mockReturnValue(latestLink),
    close: vi.fn(),
  } as any;
}

/** 标准安装记录 */
const installation: Installation = {
  id: "inst-1",
  hubUrl: "https://hub.example.com",
  appId: "app-1",
  botId: "bot-1",
  appToken: "token-1",
  webhookSecret: "secret-1",
};

describe("WxToWecom", () => {
  it("非消息事件时跳过处理", async () => {
    const client = mockWecomClient();
    const store = mockStore();
    const bridge = new WxToWecom(client, store);

    const event: HubEvent = {
      v: "1",
      type: "event",
      trace_id: "trace-1",
      installation_id: "inst-1",
      bot: { id: "bot-1" },
      event: { type: "connection.open", id: "evt-1", timestamp: "123", data: {} },
    };

    await bridge.handleWxEvent(event, installation);
    expect(client.sendMarkdown).not.toHaveBeenCalled();
  });

  it("url_verification 类型跳过处理", async () => {
    const client = mockWecomClient();
    const store = mockStore();
    const bridge = new WxToWecom(client, store);

    const event: HubEvent = {
      v: "1",
      type: "url_verification",
      trace_id: "trace-1",
      challenge: "abc",
      installation_id: "inst-1",
      bot: { id: "bot-1" },
    };

    await bridge.handleWxEvent(event, installation);
    expect(client.sendMarkdown).not.toHaveBeenCalled();
  });

  it("消息内容为空时跳过", async () => {
    const client = mockWecomClient();
    const store = mockStore({ wecomConversation: "conv-1" });
    const bridge = new WxToWecom(client, store);

    const event: HubEvent = {
      v: "1",
      type: "event",
      trace_id: "trace-1",
      installation_id: "inst-1",
      bot: { id: "bot-1" },
      event: {
        type: "message.text",
        id: "evt-1",
        timestamp: "123",
        data: { content: "", from_user_id: "wx-user-1" },
      },
    };

    await bridge.handleWxEvent(event, installation);
    expect(client.sendMarkdown).not.toHaveBeenCalled();
  });

  it("有关联记录时格式化为 Markdown 并发送", async () => {
    const client = mockWecomClient();
    const store = mockStore({ wecomConversation: "wecom-user-1" });
    const bridge = new WxToWecom(client, store);

    const event: HubEvent = {
      v: "1",
      type: "event",
      trace_id: "trace-1",
      installation_id: "inst-1",
      bot: { id: "bot-1" },
      event: {
        type: "message.text",
        id: "evt-1",
        timestamp: "123",
        data: {
          content: "你好，请帮我查一下",
          from_name: "王五",
          from_user_id: "wx-user-1",
        },
      },
    };

    await bridge.handleWxEvent(event, installation);
    expect(client.sendMarkdown).toHaveBeenCalledWith(
      "wecom-user-1",
      "微信消息",
      expect.stringContaining("王五"),
    );
  });

  it("Markdown 格式包含用户名和消息内容", async () => {
    const client = mockWecomClient();
    const store = mockStore({ wecomConversation: "conv-1" });
    const bridge = new WxToWecom(client, store);

    const event: HubEvent = {
      v: "1",
      type: "event",
      trace_id: "trace-1",
      installation_id: "inst-1",
      bot: { id: "bot-1" },
      event: {
        type: "message.text",
        id: "evt-1",
        timestamp: "123",
        data: {
          content: "测试消息",
          from_name: "赵六",
          from_user_id: "wx-user-2",
        },
      },
    };

    await bridge.handleWxEvent(event, installation);
    const markdown = client.sendMarkdown.mock.calls[0][2];
    expect(markdown).toContain("**[微信] 赵六**");
    expect(markdown).toContain("测试消息");
  });

  it("未找到关联目标用户时跳过转发", async () => {
    const client = mockWecomClient();
    /** 返回 undefined 表示无关联 */
    const store = mockStore(undefined);
    const bridge = new WxToWecom(client, store);

    const event: HubEvent = {
      v: "1",
      type: "event",
      trace_id: "trace-1",
      installation_id: "inst-1",
      bot: { id: "bot-1" },
      event: {
        type: "message.text",
        id: "evt-1",
        timestamp: "123",
        data: {
          content: "你好",
          from_name: "新用户",
          from_user_id: "wx-unknown",
        },
      },
    };

    await bridge.handleWxEvent(event, installation);
    expect(client.sendMarkdown).not.toHaveBeenCalled();
  });

  it("转发成功后保存消息关联记录", async () => {
    const client = mockWecomClient();
    const store = mockStore({ wecomConversation: "conv-target" });
    const bridge = new WxToWecom(client, store);

    const event: HubEvent = {
      v: "1",
      type: "event",
      trace_id: "trace-1",
      installation_id: "inst-1",
      bot: { id: "bot-1" },
      event: {
        type: "message.text",
        id: "evt-save",
        timestamp: "123",
        data: {
          content: "保存测试",
          from_name: "用户A",
          from_user_id: "wx-user-save",
        },
      },
    };

    await bridge.handleWxEvent(event, installation);
    expect(store.saveMessageLink).toHaveBeenCalledWith(
      expect.objectContaining({
        installationId: "inst-1",
        wecomMsgId: "evt-save",
        wxUserId: "wx-user-save",
      }),
    );
  });
});

import { describe, it, expect, vi, afterEach } from "vitest";
import { WecomToWx } from "../../src/bridge/wecom-to-wx.js";
import type { Installation } from "../../src/hub/types.js";
import type { WecomMessageData } from "../../src/wecom/event.js";

/** 构造模拟的 Store */
function mockStore(overrides: Record<string, any> = {}) {
  return {
    getInstallation: vi.fn(),
    getAllInstallations: vi.fn().mockReturnValue([]),
    saveInstallation: vi.fn(),
    saveMessageLink: vi.fn(),
    getMessageLinkByWecomMsg: vi.fn().mockReturnValue(overrides.linkByMsg ?? undefined),
    getLatestLinkByWxUser: vi.fn().mockReturnValue(overrides.latestLink ?? undefined),
    close: vi.fn(),
  } as any;
}

const installations: Installation[] = [
  {
    id: "inst-1",
    hubUrl: "https://hub.example.com",
    appId: "app-1",
    botId: "bot-1",
    appToken: "token-1",
    webhookSecret: "secret-1",
  },
];

/** 标准企业微信消息 */
function makeMsg(overrides: Partial<WecomMessageData> = {}): WecomMessageData {
  return {
    conversationId: "conv-001",
    msgId: "msg-001",
    msgType: "text",
    content: "你好微信",
    userId: "wecom-user-1",
    userName: "企微用户",
    frame: {},
    ...overrides,
  };
}

describe("WecomToWx", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("消息内容为空时跳过处理", async () => {
    const store = mockStore();
    const bridge = new WecomToWx(store);

    await bridge.handleWecomMessage(makeMsg({ content: "" }), installations);
    expect(store.getMessageLinkByWecomMsg).not.toHaveBeenCalled();
  });

  it("通过 wecomMsgId 找到关联记录后转发", async () => {
    const link = {
      installationId: "inst-1",
      wecomMsgId: "msg-001",
      wecomConversation: "conv-001",
      wxUserId: "wx-target-user",
      wxUserName: "微信用户",
    };
    const store = mockStore({ linkByMsg: link });
    const bridge = new WecomToWx(store);

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true }),
    }) as any;

    await bridge.handleWecomMessage(makeMsg(), installations);

    expect(globalThis.fetch).toHaveBeenCalled();
    const fetchCall = vi.mocked(globalThis.fetch).mock.calls[0];
    const url = fetchCall[0] as string;
    expect(url).toContain("/api/v1/bots/bot-1/messages");
  });

  it("未找到任何关联记录时跳过", async () => {
    const store = mockStore();
    const bridge = new WecomToWx(store);

    globalThis.fetch = vi.fn() as any;

    await bridge.handleWecomMessage(makeMsg(), installations);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("关联的安装记录不存在时跳过", async () => {
    const link = {
      installationId: "inst-not-exist",
      wecomMsgId: "msg-001",
      wecomConversation: "conv-001",
      wxUserId: "wx-target-user",
      wxUserName: "微信用户",
    };
    const store = mockStore({ linkByMsg: link });
    const bridge = new WecomToWx(store);

    globalThis.fetch = vi.fn() as any;

    await bridge.handleWecomMessage(makeMsg(), installations);
    /** 因为 installations 中没有 inst-not-exist，所以不会调用 fetch */
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("Hub API 调用失败时不抛异常（错误被捕获）", async () => {
    const link = {
      installationId: "inst-1",
      wecomMsgId: "msg-001",
      wecomConversation: "conv-001",
      wxUserId: "wx-target-user",
      wxUserName: "微信用户",
    };
    const store = mockStore({ linkByMsg: link });
    const bridge = new WecomToWx(store);

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      text: () => Promise.resolve("server error"),
    }) as any;

    /** 不应抛出异常 */
    await expect(
      bridge.handleWecomMessage(makeMsg(), installations),
    ).resolves.toBeUndefined();
  });

  it("转发成功后保存反向关联记录", async () => {
    const link = {
      installationId: "inst-1",
      wecomMsgId: "msg-001",
      wecomConversation: "conv-001",
      wxUserId: "wx-target-user",
      wxUserName: "微信用户",
    };
    const store = mockStore({ linkByMsg: link });
    const bridge = new WecomToWx(store);

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true }),
    }) as any;

    await bridge.handleWecomMessage(makeMsg(), installations);
    expect(store.saveMessageLink).toHaveBeenCalledWith(
      expect.objectContaining({
        installationId: "inst-1",
        wxUserId: "wx-target-user",
      }),
    );
  });
});

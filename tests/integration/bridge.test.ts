/**
 * 企业微信 Bridge 集成测试
 *
 * 测试 Hub <-> App 的完整通信链路，不依赖企业微信 SDK：
 * 1. Mock Hub Server 模拟 OpeniLink Hub
 * 2. 创建轻量 App HTTP 服务器（仅含 webhook handler）
 * 3. 使用内存 SQLite 存储 + Mock WecomClient
 * 4. 验证微信->企业微信和企业微信->微信的双向桥接
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import http from "node:http";
import { Store } from "../../src/store.js";
import { handleWebhook } from "../../src/hub/webhook.js";
import { WxToWecom } from "../../src/bridge/wx-to-wecom.js";
import { WecomToWx } from "../../src/bridge/wecom-to-wx.js";
import type { WecomMessageData } from "../../src/wecom/event.js";
import {
  startMockHub,
  injectMessage,
  getMessages,
  resetMock,
  waitFor,
  MOCK_HUB_URL,
  MOCK_WEBHOOK_SECRET,
  MOCK_APP_TOKEN,
  MOCK_INSTALLATION_ID,
  MOCK_BOT_ID,
  APP_PORT,
} from "./setup.js";

// --- Mock WecomClient ---
// 模拟企业微信客户端，不连接真实企业微信，仅记录发送的消息

/** 记录企业微信端发送的消息 */
let wecomSentMessages: Array<{
  toUser: string;
  title: string;
  content: string;
}> = [];

/**
 * 创建 Mock WecomClient
 * 只实现 sendMarkdown 和 sendText 方法，仅记录调用
 */
function createMockWecomClient() {
  return {
    sendMarkdown: async (
      toUser: string,
      title: string,
      content: string,
    ): Promise<void> => {
      wecomSentMessages.push({ toUser, title, content });
    },
    sendText: async (toUser: string, text: string): Promise<void> => {
      wecomSentMessages.push({ toUser, title: "text", content: text });
    },
  } as any;
}

// --- 测试主体 ---

describe("企业微信 Bridge 集成测试", () => {
  let mockHubHandle: { server: http.Server; close: () => Promise<void> };
  let appServer: http.Server;
  let store: Store;
  let wxToWecom: WxToWecom;
  let wecomToWx: WecomToWx;

  beforeAll(async () => {
    // 1. 启动 Mock Hub Server
    mockHubHandle = await startMockHub();

    // 2. 初始化内存数据库和存储
    store = new Store(":memory:");

    // 3. 注入 installation 记录（模拟已完成 OAuth 安装）
    store.saveInstallation({
      id: MOCK_INSTALLATION_ID,
      hubUrl: MOCK_HUB_URL,
      appId: "test-app",
      botId: MOCK_BOT_ID,
      appToken: MOCK_APP_TOKEN,
      webhookSecret: MOCK_WEBHOOK_SECRET,
      createdAt: new Date().toISOString(),
    });

    // 4. 创建 Mock WecomClient 和桥接模块
    const mockClient = createMockWecomClient();
    wxToWecom = new WxToWecom(mockClient, store);
    wecomToWx = new WecomToWx(store);

    // 5. 启动轻量 App HTTP 服务器（只处理 /hub/webhook）
    appServer = http.createServer(async (req, res) => {
      const url = new URL(req.url!, `http://localhost:${APP_PORT}`);

      if (req.method === "POST" && url.pathname === "/hub/webhook") {
        // handleWebhook 内部自带 processEvent 处理逻辑
        await handleWebhook(req, res, store);
        return;
      }

      // 健康检查
      if (url.pathname === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok" }));
        return;
      }

      res.writeHead(404);
      res.end("Not Found");
    });

    await new Promise<void>((resolve, reject) => {
      appServer.on("error", reject);
      appServer.listen(APP_PORT, () => {
        console.log(`[test] App Server 已启动，端口 ${APP_PORT}`);
        resolve();
      });
    });
  });

  afterAll(async () => {
    // 关闭 App 服务器
    await new Promise<void>((resolve) =>
      appServer.close(() => {
        console.log("[test] App Server 已关闭");
        resolve();
      }),
    );

    // 关闭 Mock Hub Server
    await mockHubHandle.close();

    // 关闭数据库
    store.close();
  });

  beforeEach(() => {
    // 每个测试前重置消息记录
    resetMock();
    wecomSentMessages = [];
  });

  // --- 健康检查测试 ---

  it("Mock Hub Server 健康检查", async () => {
    const res = await fetch(`${MOCK_HUB_URL}/health`);
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data).toEqual({ status: "ok" });
  });

  it("App Server 健康检查", async () => {
    const res = await fetch(`http://localhost:${APP_PORT}/health`);
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data).toEqual({ status: "ok" });
  });

  // --- Webhook 内置处理链路测试 ---
  // handleWebhook 内部的 processEvent 收到 message 事件后会：
  // 1. 保存 messageLink 到 Store
  // 2. 通过 HubClient 回复消息到 Mock Hub

  it("微信文本消息经 webhook 内置处理后应回复到 Mock Hub", async () => {
    // Mock Hub 注入微信消息 -> 转发到 App webhook -> processEvent 自动回复
    await injectMessage("user_alice", "你好企微");

    // 等待 processEvent 处理完成（HubClient 发送消息到 Mock Hub）
    await waitFor(async () => {
      const msgs = await getMessages();
      return msgs.length > 0;
    }, 5000);

    // 验证 Mock Hub 收到了 App 的自动回复
    const hubMessages = await getMessages();
    expect(hubMessages.length).toBe(1);
    // processEvent 的回复内容格式是 "收到消息: {原始内容}"
    expect(hubMessages[0].content.text).toContain("收到消息");
    expect(hubMessages[0].content.text).toContain("你好企微");
  });

  it("多条微信消息应依次被 webhook 处理并回复", async () => {
    await injectMessage("user_bob", "第一条消息");
    await injectMessage("user_carol", "第二条消息");

    // 等待两条消息都处理完成
    await waitFor(async () => {
      const msgs = await getMessages();
      return msgs.length >= 2;
    }, 5000);

    const hubMessages = await getMessages();
    expect(hubMessages.length).toBe(2);
    expect(hubMessages[0].content.text).toContain("第一条消息");
    expect(hubMessages[1].content.text).toContain("第二条消息");
  });

  it("webhook 处理后消息关联应正确保存到 Store", async () => {
    await injectMessage("user_charlie", "测试映射");

    // 等待处理完成
    await waitFor(async () => {
      const msgs = await getMessages();
      return msgs.length > 0;
    }, 5000);

    // 验证 Store 中保存了消息关联
    const link = store.getLatestLinkByWxUser("user_charlie");
    expect(link).toBeDefined();
    expect(link!.wxUserId).toBe("user_charlie");
    expect(link!.wxUserName).toBe("user_charlie");
    expect(link!.installationId).toBe(MOCK_INSTALLATION_ID);
  });

  // --- WxToWecom 桥接测试 ---

  it("WxToWecom 应将微信消息转发到企业微信", async () => {
    // 先建立关联记录，使 WxToWecom 能找到目标企业微信用户
    store.saveMessageLink({
      installationId: MOCK_INSTALLATION_ID,
      wecomMsgId: "wecom_msg_init",
      wecomConversation: "wecom_target_user",
      wxUserId: "wx_dave",
      wxUserName: "Dave",
    });

    // 构造 HubEvent 模拟微信消息
    const hubEvent = {
      v: "1",
      type: "event" as const,
      trace_id: `tr_${Date.now()}`,
      installation_id: MOCK_INSTALLATION_ID,
      bot: { id: MOCK_BOT_ID },
      event: {
        type: "message.text",
        id: `evt_${Date.now()}`,
        timestamp: String(Date.now()),
        data: {
          from_name: "Dave",
          from_user_id: "wx_dave",
          sender_name: "Dave",
          sender_id: "wx_dave",
          content: "通过桥接转发的消息",
        },
      },
    };

    const installation = store.getInstallation(MOCK_INSTALLATION_ID)!;
    await wxToWecom.handleWxEvent(hubEvent, installation);

    // 验证企业微信端收到了转发的消息
    expect(wecomSentMessages.length).toBe(1);
    expect(wecomSentMessages[0].toUser).toBe("wecom_target_user");
    expect(wecomSentMessages[0].content).toContain("Dave");
    expect(wecomSentMessages[0].content).toContain("通过桥接转发的消息");
  });

  it("WxToWecom 无关联记录时应跳过转发", async () => {
    // 不建立关联记录，直接推送微信消息
    const hubEvent = {
      v: "1",
      type: "event" as const,
      trace_id: `tr_${Date.now()}`,
      installation_id: MOCK_INSTALLATION_ID,
      bot: { id: MOCK_BOT_ID },
      event: {
        type: "message.text",
        id: `evt_${Date.now()}`,
        timestamp: String(Date.now()),
        data: {
          from_name: "UnknownUser",
          from_user_id: "wx_unknown_no_link",
          sender_name: "UnknownUser",
          sender_id: "wx_unknown_no_link",
          content: "这条消息无目标",
        },
      },
    };

    const installation = store.getInstallation(MOCK_INSTALLATION_ID)!;
    await wxToWecom.handleWxEvent(hubEvent, installation);

    // 企业微信端不应收到消息
    expect(wecomSentMessages.length).toBe(0);
  });

  // --- WecomToWx 桥接测试 ---

  it("WecomToWx 应将企业微信消息转发到微信", async () => {
    // 先建立关联记录
    const wecomMsgId = `wecom_reply_${Date.now()}`;
    store.saveMessageLink({
      installationId: MOCK_INSTALLATION_ID,
      wecomMsgId: wecomMsgId,
      wecomConversation: "conv_wecom_001",
      wxUserId: "user_eve",
      wxUserName: "Eve",
    });

    // 构造企业微信消息
    const wecomData: WecomMessageData = {
      conversationId: "conv_wecom_001",
      msgId: wecomMsgId,
      msgType: "text",
      content: "收到，已处理",
      userId: "wecom_staff_001",
      userName: "客服小王",
      frame: null,
    };

    // 触发 WecomToWx 处理
    const installations = store.getAllInstallations();
    await wecomToWx.handleWecomMessage(wecomData, installations);

    // 等待 HubClient 将消息发送到 Mock Hub
    await waitFor(async () => {
      const msgs = await getMessages();
      return msgs.length > 0;
    }, 5000);

    // 验证 Mock Hub 收到了转发到微信的消息
    const hubMessages = await getMessages();
    expect(hubMessages.length).toBe(1);
    expect(hubMessages[0].conversation_id).toBe("user_eve");
    expect(hubMessages[0].content.text).toBe("收到，已处理");
  });

  it("WecomToWx 未找到关联记录时应跳过转发", async () => {
    // 构造一条没有关联记录的企业微信消息
    const wecomData: WecomMessageData = {
      conversationId: "conv_orphan",
      msgId: `wecom_orphan_${Date.now()}`,
      msgType: "text",
      content: "找不到关联的消息",
      userId: "wecom_unknown",
      userName: "未知用户",
      frame: null,
    };

    const installations = store.getAllInstallations();
    await wecomToWx.handleWecomMessage(wecomData, installations);

    // Mock Hub 不应收到任何消息
    const hubMessages = await getMessages();
    expect(hubMessages.length).toBe(0);
  });

  // --- Webhook 签名验证测试 ---

  it("无效签名的 webhook 请求应被拒绝（401）", async () => {
    const hubEvent = {
      v: "1",
      type: "event",
      trace_id: "tr_bad_sig",
      installation_id: MOCK_INSTALLATION_ID,
      bot: { id: MOCK_BOT_ID },
      event: {
        type: "message",
        id: "evt_bad",
        timestamp: String(Date.now()),
        data: { text: "恶意消息", user_id: "hacker", user_name: "hacker" },
      },
    };

    const res = await fetch(`http://localhost:${APP_PORT}/hub/webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Hub-Signature": "invalid_signature_here",
      },
      body: JSON.stringify(hubEvent),
    });

    // 应返回 401
    expect(res.status).toBe(401);
  });

  it("缺少签名头的 webhook 请求应被拒绝（401）", async () => {
    const hubEvent = {
      v: "1",
      type: "event",
      trace_id: "tr_no_sig",
      installation_id: MOCK_INSTALLATION_ID,
      bot: { id: MOCK_BOT_ID },
      event: {
        type: "message",
        id: "evt_no_sig",
        timestamp: String(Date.now()),
        data: { text: "无签名", user_id: "user", user_name: "user" },
      },
    };

    const res = await fetch(`http://localhost:${APP_PORT}/hub/webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // 不提供 X-Hub-Signature
      },
      body: JSON.stringify(hubEvent),
    });

    expect(res.status).toBe(401);
  });

  it("url_verification 请求应正确返回 challenge", async () => {
    const verifyEvent = {
      v: "1",
      type: "url_verification",
      challenge: "test_challenge_token_123",
    };

    const res = await fetch(`http://localhost:${APP_PORT}/hub/webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(verifyEvent),
    });

    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data).toEqual({ challenge: "test_challenge_token_123" });
  });

  it("不存在的 installation_id 应返回 404", async () => {
    const hubEvent = {
      v: "1",
      type: "event",
      trace_id: "tr_unknown_inst",
      installation_id: "nonexistent-installation",
      bot: { id: MOCK_BOT_ID },
      event: {
        type: "message",
        id: "evt_unknown",
        timestamp: String(Date.now()),
        data: { text: "test", user_id: "user", user_name: "user" },
      },
    };

    const res = await fetch(`http://localhost:${APP_PORT}/hub/webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Hub-Signature": "whatever",
      },
      body: JSON.stringify(hubEvent),
    });

    expect(res.status).toBe(404);
  });

  // --- 完整双向链路测试 ---

  it("完整双向链路：微信->企业微信->微信", async () => {
    // 步骤 1: 先建立关联记录
    const wecomMsgId = `wecom_frank_${Date.now()}`;
    store.saveMessageLink({
      installationId: MOCK_INSTALLATION_ID,
      wecomMsgId: wecomMsgId,
      wecomConversation: "wecom_frank_conv",
      wxUserId: "user_frank",
      wxUserName: "Frank",
    });

    // 步骤 2: 微信消息 -> Hub -> App -> webhook processEvent 自动回复
    await injectMessage("user_frank", "你好，请帮我查个信息");

    await waitFor(async () => {
      const msgs = await getMessages();
      return msgs.length > 0;
    }, 5000);

    // 验证 processEvent 的自动回复
    let hubMessages = await getMessages();
    expect(hubMessages.length).toBe(1);
    expect(hubMessages[0].content.text).toContain("收到消息");

    // 步骤 3: 清空 Hub 消息记录，准备测试反向链路
    resetMock();

    // 步骤 4: 企业微信用户回复 -> WecomToWx -> HubClient -> 微信
    const replyData: WecomMessageData = {
      conversationId: "wecom_frank_conv",
      msgId: wecomMsgId,
      msgType: "text",
      content: "查好了，结果如下...",
      userId: "wecom_helper",
      userName: "客服小李",
      frame: null,
    };

    const installations = store.getAllInstallations();
    await wecomToWx.handleWecomMessage(replyData, installations);

    // 验证 Mock Hub 收到了回复
    await waitFor(async () => {
      const msgs = await getMessages();
      return msgs.length > 0;
    }, 5000);

    hubMessages = await getMessages();
    expect(hubMessages.length).toBe(1);
    expect(hubMessages[0].conversation_id).toBe("user_frank");
    expect(hubMessages[0].content.text).toBe("查好了，结果如下...");
  });
});

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Store } from "../src/store.js";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("Store", () => {
  let store: Store;
  let dbPath: string;

  beforeEach(() => {
    /** 每个测试用例使用独立的临时数据库 */
    const dir = join(tmpdir(), `wecom-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(dir, { recursive: true });
    dbPath = join(dir, "test.db");
    store = new Store(dbPath);
  });

  afterEach(() => {
    store.close();
  });

  /* ======================== installations ======================== */

  it("保存并查询安装记录", () => {
    store.saveInstallation({
      id: "inst-001",
      hubUrl: "https://hub.example.com",
      appId: "app-001",
      botId: "bot-001",
      appToken: "token-001",
      webhookSecret: "secret-001",
    });

    const result = store.getInstallation("inst-001");
    expect(result).toBeDefined();
    expect(result!.id).toBe("inst-001");
    expect(result!.hubUrl).toBe("https://hub.example.com");
    expect(result!.appToken).toBe("token-001");
  });

  it("upsert 更新已有安装记录", () => {
    store.saveInstallation({
      id: "inst-002",
      hubUrl: "https://hub1.example.com",
      appId: "app-002",
      botId: "bot-002",
      appToken: "token-old",
      webhookSecret: "secret-002",
    });

    store.saveInstallation({
      id: "inst-002",
      hubUrl: "https://hub2.example.com",
      appId: "app-002",
      botId: "bot-002",
      appToken: "token-new",
      webhookSecret: "secret-002",
    });

    const result = store.getInstallation("inst-002");
    expect(result!.appToken).toBe("token-new");
    expect(result!.hubUrl).toBe("https://hub2.example.com");
  });

  it("查询不存在的安装记录返回 undefined", () => {
    const result = store.getInstallation("not-exist");
    expect(result).toBeUndefined();
  });

  it("查询全部安装记录", () => {
    store.saveInstallation({
      id: "inst-a",
      hubUrl: "https://hub.example.com",
      appId: "app-a",
      botId: "bot-a",
      appToken: "token-a",
      webhookSecret: "secret-a",
    });
    store.saveInstallation({
      id: "inst-b",
      hubUrl: "https://hub.example.com",
      appId: "app-b",
      botId: "bot-b",
      appToken: "token-b",
      webhookSecret: "secret-b",
    });

    const all = store.getAllInstallations();
    expect(all.length).toBe(2);
  });

  /* ======================== message_links ======================== */

  it("保存消息关联并按 wecomMsgId 查询", () => {
    store.saveInstallation({
      id: "inst-100",
      hubUrl: "https://hub.example.com",
      appId: "app-100",
      botId: "bot-100",
      appToken: "token-100",
      webhookSecret: "secret-100",
    });

    const linkId = store.saveMessageLink({
      installationId: "inst-100",
      wecomMsgId: "wechat-msg-001",
      wecomConversation: "conv-001",
      wxUserId: "wx-user-001",
      wxUserName: "张三",
    });

    expect(linkId).toBeGreaterThan(0);

    const link = store.getMessageLinkByWecomMsg("wechat-msg-001");
    expect(link).toBeDefined();
    expect(link!.wecomMsgId).toBe("wechat-msg-001");
    expect(link!.wecomConversation).toBe("conv-001");
    expect(link!.wxUserId).toBe("wx-user-001");
    expect(link!.wxUserName).toBe("张三");
  });

  it("按 wecomMsgId 查询不存在的记录返回 undefined", () => {
    const result = store.getMessageLinkByWecomMsg("not-exist");
    expect(result).toBeUndefined();
  });

  it("按微信用户 ID 查询最新关联记录", () => {
    store.saveInstallation({
      id: "inst-200",
      hubUrl: "https://hub.example.com",
      appId: "app-200",
      botId: "bot-200",
      appToken: "token-200",
      webhookSecret: "secret-200",
    });

    store.saveMessageLink({
      installationId: "inst-200",
      wecomMsgId: "msg-old",
      wecomConversation: "conv-old",
      wxUserId: "wx-user-002",
      wxUserName: "李四",
      createdAt: "2025-01-01T00:00:00.000Z",
    });

    store.saveMessageLink({
      installationId: "inst-200",
      wecomMsgId: "msg-new",
      wecomConversation: "conv-new",
      wxUserId: "wx-user-002",
      wxUserName: "李四",
      createdAt: "2025-06-01T00:00:00.000Z",
    });

    const latest = store.getLatestLinkByWxUser("wx-user-002");
    expect(latest).toBeDefined();
    expect(latest!.wecomMsgId).toBe("msg-new");
    expect(latest!.wecomConversation).toBe("conv-new");
  });
});

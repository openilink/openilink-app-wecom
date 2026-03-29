import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHmac } from "node:crypto";
import { handleWebhook, readBody } from "../../src/hub/webhook.js";
import type { IncomingMessage, ServerResponse } from "node:http";
import { EventEmitter } from "node:events";

/** 构造模拟的 IncomingMessage */
function mockReq(method: string, body: string, headers: Record<string, string> = {}): IncomingMessage {
  const emitter = new EventEmitter() as any;
  emitter.method = method;
  emitter.headers = headers;
  emitter.url = "/webhook";
  /** 模拟可读流 */
  process.nextTick(() => {
    emitter.emit("data", Buffer.from(body));
    emitter.emit("end");
  });
  return emitter as IncomingMessage;
}

/** 构造模拟的 ServerResponse */
function mockRes(): ServerResponse & { _status: number; _body: string; _headers: Record<string, string> } {
  const res: any = {
    _status: 0,
    _body: "",
    _headers: {} as Record<string, string>,
    writeHead(status: number, headers?: Record<string, string>) {
      res._status = status;
      if (headers) Object.assign(res._headers, headers);
    },
    end(body?: string) {
      res._body = body ?? "";
    },
  };
  return res;
}

/** 构造模拟的 Store */
function mockStore(installation?: any) {
  return {
    getInstallation: vi.fn().mockReturnValue(installation),
    getAllInstallations: vi.fn().mockReturnValue(installation ? [installation] : []),
    saveInstallation: vi.fn(),
    saveMessageLink: vi.fn(),
    getMessageLinkByWecomMsg: vi.fn(),
    getLatestLinkByWxUser: vi.fn(),
    close: vi.fn(),
  } as any;
}

describe("readBody", () => {
  it("读取完整请求体", async () => {
    const req = mockReq("POST", '{"hello":"world"}');
    const body = await readBody(req);
    expect(body).toBe('{"hello":"world"}');
  });
});

describe("handleWebhook", () => {
  it("非 POST 请求返回 405", async () => {
    const req = mockReq("GET", "");
    req.method = "GET";
    const res = mockRes();
    const store = mockStore();

    await handleWebhook(req, res, store);
    expect(res._status).toBe(405);
  });

  it("无效 JSON 返回 400", async () => {
    const req = mockReq("POST", "not json");
    const res = mockRes();
    const store = mockStore();

    await handleWebhook(req, res, store);
    expect(res._status).toBe(400);
  });

  it("url_verification 类型直接返回 challenge", async () => {
    const body = JSON.stringify({
      type: "url_verification",
      challenge: "test-challenge-123",
      installation_id: "inst-1",
    });
    const req = mockReq("POST", body);
    const res = mockRes();
    const store = mockStore();

    await handleWebhook(req, res, store);
    expect(res._status).toBe(200);
    expect(JSON.parse(res._body)).toEqual({ challenge: "test-challenge-123" });
  });

  it("未找到安装记录返回 404", async () => {
    const body = JSON.stringify({
      type: "event",
      installation_id: "inst-unknown",
      trace_id: "trace-1",
      event: { type: "message", id: "msg-1", timestamp: "123", data: {} },
    });
    const req = mockReq("POST", body, { "x-hub-signature": "fake" });
    const res = mockRes();
    const store = mockStore(undefined);

    await handleWebhook(req, res, store);
    expect(res._status).toBe(404);
  });

  it("签名验证失败返回 401", async () => {
    const installation = {
      id: "inst-1",
      webhookSecret: "my-secret",
      hubUrl: "https://hub.example.com",
      appToken: "token",
      botId: "bot-1",
    };
    const body = JSON.stringify({
      type: "event",
      installation_id: "inst-1",
      trace_id: "trace-1",
      event: { type: "message", id: "msg-1", timestamp: "123", data: {} },
    });
    const req = mockReq("POST", body, { "x-hub-signature": "wrong-signature" });
    const res = mockRes();
    const store = mockStore(installation);

    await handleWebhook(req, res, store);
    expect(res._status).toBe(401);
  });

  it("签名合法时返回 200", async () => {
    const installation = {
      id: "inst-1",
      webhookSecret: "my-secret",
      hubUrl: "https://hub.example.com",
      appToken: "token",
      botId: "bot-1",
    };
    const body = JSON.stringify({
      type: "event",
      installation_id: "inst-1",
      trace_id: "trace-1",
      bot: { id: "bot-1" },
      event: {
        type: "message",
        id: "msg-1",
        timestamp: "123",
        data: { text: "hello", user_id: "user-1", conversation_id: "conv-1" },
      },
    });
    const sig = createHmac("sha256", "my-secret").update(body).digest("hex");
    const req = mockReq("POST", body, { "x-hub-signature": sig });
    const res = mockRes();
    const store = mockStore(installation);

    /** mock fetch 以避免真实网络请求 */
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true }),
    }) as any;

    try {
      await handleWebhook(req, res, store);
      expect(res._status).toBe(200);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

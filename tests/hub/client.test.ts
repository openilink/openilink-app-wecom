import { describe, it, expect, vi, afterEach } from "vitest";
import { HubClient } from "../../src/hub/client.js";

describe("HubClient", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("构造时移除 hubUrl 末尾斜杠", () => {
    const client = new HubClient("https://hub.example.com///", "token-123");
    /** 通过发送消息来间接验证 URL 构造 */
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true, message_id: "msg-1" }),
    }) as any;

    client.sendText("inst-1", "bot-1", "conv-1", "hello");

    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith(
      "https://hub.example.com/api/v1/bots/bot-1/messages",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("sendText 调用正确的 API 端点并携带 Authorization", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true, message_id: "msg-out" }),
    }) as any;

    const client = new HubClient("https://hub.example.com", "my-token");
    const result = await client.sendText("inst-1", "bot-1", "conv-1", "你好");

    expect(result.ok).toBe(true);
    const fetchCall = vi.mocked(globalThis.fetch).mock.calls[0];
    const opts = fetchCall[1] as RequestInit;
    const headers = opts.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer my-token");
    expect(headers["X-Installation-Id"]).toBe("inst-1");
  });

  it("sendImage 携带正确的消息类型", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true }),
    }) as any;

    const client = new HubClient("https://hub.example.com", "token");
    await client.sendImage("inst-1", "bot-1", "conv-1", "https://img.example.com/1.png", "图片说明");

    const body = JSON.parse(vi.mocked(globalThis.fetch).mock.calls[0][1]!.body as string);
    expect(body.content.type).toBe("image");
    expect(body.content.image_url).toBe("https://img.example.com/1.png");
    expect(body.content.caption).toBe("图片说明");
  });

  it("sendFile 携带正确的文件信息", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true }),
    }) as any;

    const client = new HubClient("https://hub.example.com", "token");
    await client.sendFile("inst-1", "bot-1", "conv-1", "https://file.example.com/doc.pdf", "report.pdf");

    const body = JSON.parse(vi.mocked(globalThis.fetch).mock.calls[0][1]!.body as string);
    expect(body.content.type).toBe("file");
    expect(body.content.file_name).toBe("report.pdf");
  });

  it("API 返回非 2xx 时抛出错误", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve("Internal Server Error"),
    }) as any;

    const client = new HubClient("https://hub.example.com", "token");
    await expect(
      client.sendText("inst-1", "bot-1", "conv-1", "hello"),
    ).rejects.toThrow("Hub API 调用失败");
  });
});

import type { IncomingMessage, ServerResponse } from "node:http";
import { verifySignature } from "../utils/crypto.js";
import type { Store } from "../store.js";
import type { HubEvent } from "./types.js";
import { HubClient } from "./client.js";

/** 同步响应截止时间（毫秒），超过此时间返回 reply_async */
const SYNC_DEADLINE = 2500;

/** command 事件处理器类型，返回文本结果 */
export type CommandHandler = (
  event: HubEvent,
  installationId: string,
) => Promise<string>;

/**
 * 从 IncomingMessage 中读取完整请求体
 */
export function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

/**
 * 处理 Hub 推送的 Webhook 事件
 * POST /webhook
 *
 * 流程：
 * 1. 读取请求体
 * 2. 查找安装记录，验证 HMAC-SHA256 签名
 * 3. 处理 url_verification 或业务事件
 *
 * command 事件使用 Promise.race + 2500ms deadline 实现同步/异步响应：
 * - 在 deadline 内完成 → 返回 {"reply": "结果"}
 * - 超时 → 返回 {"reply_async": true}，后台继续执行并通过 HubClient 异步推送
 */
export async function handleWebhook(
  req: IncomingMessage,
  res: ServerResponse,
  store: Store,
  onCommand?: CommandHandler,
): Promise<void> {
  /** 只接受 POST 请求 */
  if (req.method !== "POST") {
    res.writeHead(405, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Method Not Allowed" }));
    return;
  }

  let body: string;
  try {
    body = await readBody(req);
  } catch {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "无法读取请求体" }));
    return;
  }

  /** 解析事件 */
  let event: HubEvent;
  try {
    event = JSON.parse(body) as HubEvent;
  } catch {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "无效的 JSON 格式" }));
    return;
  }

  /** URL 验证请求直接回传 challenge */
  if (event.type === "url_verification") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ challenge: event.challenge }));
    return;
  }

  /** 查找安装记录 */
  const installation = store.getInstallation(event.installation_id);
  if (!installation) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "未找到安装记录" }));
    return;
  }

  /** 验证签名 */
  const signature = req.headers["x-hub-signature"] as string | undefined;
  if (!signature || !verifySignature(installation.webhookSecret, body, signature)) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "签名验证失败" }));
    return;
  }

  /** command 事件：同步/异步响应模式 */
  if (event.type === "event" && event.event?.type === "command" && onCommand) {
    const commandPromise = onCommand(event, event.installation_id);

    // 使用 Promise.race 实现 deadline 控制
    const timeoutSymbol = Symbol("timeout");
    const timeoutPromise = new Promise<typeof timeoutSymbol>((resolve) =>
      setTimeout(() => resolve(timeoutSymbol), SYNC_DEADLINE),
    );

    const result = await Promise.race([commandPromise, timeoutPromise]);

    if (result === timeoutSymbol) {
      // 超时：立即返回异步标记，后台继续执行
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ reply_async: true }));
      // 后台等待完成后通过 HubClient 异步推送结果
      commandPromise
        .then((asyncResult) => {
          const hubClient = new HubClient(installation.hubUrl, installation.appToken);
          const userId = (event.event?.data.user_id as string) || "";
          const convId = (event.event?.data.conversation_id as string) || userId;
          return hubClient.sendText(installation.id, installation.botId, convId, asyncResult);
        })
        .catch((err) => {
          console.error(`[webhook] command 异步执行异常 (trace=${event.trace_id}):`, err);
        });
    } else {
      // 在 deadline 内完成：同步返回结果
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ reply: result }));
    }
    return;
  }

  /** 处理其他业务事件 */
  if (event.type === "event" && event.event) {
    try {
      await processEvent(event, installation, store);
    } catch (err) {
      console.error(`[webhook] 处理事件失败: trace_id=${event.trace_id}`, err);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "事件处理失败" }));
      return;
    }
  }

  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: true }));
}

/**
 * 处理具体业务事件
 * 根据 event.type 分发到不同的处理逻辑
 */
async function processEvent(
  hubEvent: HubEvent,
  installation: { id: string; hubUrl: string; appToken: string; botId: string },
  store: Store,
): Promise<void> {
  const evt = hubEvent.event!;
  const data = evt.data;

  switch (evt.type) {
    case "message": {
      /** 处理消息事件 */
      const text = (data.text as string) || "";
      const userId = (data.user_id as string) || "";
      const userName = (data.user_name as string) || "";
      const conversationId = (data.conversation_id as string) || "";
      const msgId = evt.id;

      console.log(
        `[webhook] 收到消息: installation=${installation.id}, user=${userId}, msg=${msgId}`,
      );

      /** 保存消息关联 */
      store.saveMessageLink({
        installationId: installation.id,
        wecomMsgId: msgId,
        wecomConversation: conversationId,
        wxUserId: userId,
        wxUserName: userName,
      });

      /** 回复确认（示例：回显消息） */
      const client = new HubClient(installation.hubUrl, installation.appToken);
      await client.sendText(
        installation.id,
        installation.botId,
        conversationId,
        `收到消息: ${text}`,
      );
      break;
    }

    default:
      console.log(
        `[webhook] 未知事件类型: ${evt.type}, trace_id=${hubEvent.trace_id}`,
      );
  }
}

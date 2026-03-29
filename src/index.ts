import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { loadConfig } from "./config.js";
import { Store } from "./store.js";
import { Router } from "./router.js";
import { WecomClient } from "./wecom/client.js";
import { registerWecomEvents } from "./wecom/event.js";
import { collectAllTools } from "./tools/index.js";
import { handleOAuthSetup, handleOAuthRedirect } from "./hub/oauth.js";
import { handleWebhook } from "./hub/webhook.js";
import { getManifestJSON, manifest } from "./hub/manifest.js";
import { HubClient } from "./hub/client.js";
import { WxToWecom } from "./bridge/wx-to-wecom.js";
import { WecomToWx } from "./bridge/wecom-to-wx.js";
import type { WecomMessageData } from "./wecom/event.js";

/** 应用主入口 */
async function main(): Promise<void> {
  /** 1. 加载配置 */
  const config = loadConfig();
  console.log("[wecom] 配置加载完成, port=%s", config.port);

  /** 2. 初始化持久化存储 */
  const store = new Store(config.dbPath);
  console.log("[wecom] 数据库已连接: %s", config.dbPath);

  /** 3. 创建企业微信客户端并启动长连接 */
  const wecomClient = new WecomClient(
    config.wecomBotId,
    config.wecomBotSecret,
    config.wecomCorpId || undefined,
    config.wecomCorpSecret || undefined,
  );
  await wecomClient.start();
  console.log("[wecom] 企业微信客户端已启动");

  /** 4. 收集所有 AI Tools 并创建路由 */
  const { definitions, handlers } = collectAllTools(wecomClient);
  const router = new Router();
  router.register(definitions, handlers);
  console.log("[wecom] 已注册 %d 个 AI Tools", definitions.length);

  /** 将工具定义注入到清单中 */
  manifest.tools = definitions;

  /** 5. 初始化双向桥接 */
  const wxToWecom = new WxToWecom(wecomClient, store);
  const wecomToWx = new WecomToWx(store);

  /** 6. 注册企业微信长连接消息事件 */
  registerWecomEvents(wecomClient.getWSClient(), async (msg: WecomMessageData) => {
    console.log("[wecom] 收到企业微信消息: userId=%s, type=%s", msg.userId, msg.msgType);

    /** 先尝试命令路由 */
    const cmdResult = await router.handleCommand(msg.content, {
      installationId: "",
      botId: config.wecomBotId,
      userId: msg.userId,
      traceId: msg.msgId,
    });
    if (cmdResult !== null) {
      await wecomClient.replyStream(msg.frame, cmdResult);
      return;
    }

    /** 非命令消息通过桥接转发到微信 */
    const installations = store.getAllInstallations();
    if (installations.length > 0) {
      await wecomToWx.handleWecomMessage(msg, installations);
    }
  });

  /** 7. 启动 HTTP 服务 */
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    const pathname = url.pathname;

    try {
      /** 健康检查 */
      if (pathname === "/healthz") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok" }));
        return;
      }

      /** App 清单查询 */
      if (pathname === "/manifest" && req.method === "GET") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(getManifestJSON());
        return;
      }

      /** OAuth 安装发起 */
      if (pathname === "/oauth/setup" && req.method === "GET") {
        handleOAuthSetup(req, res, config);
        return;
      }

      /** OAuth 回调 */
      if (pathname === "/oauth/redirect" && req.method === "GET") {
        await handleOAuthRedirect(req, res, config, store);
        return;
      }

      /** Hub Webhook 事件接收 */
      if (pathname === "/webhook" && req.method === "POST") {
        await handleWebhook(req, res, store);
        return;
      }

      /** 404 兜底 */
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not Found" }));
    } catch (err) {
      console.error("[wecom] 未捕获的异常:", err);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Internal Server Error" }));
    }
  });

  server.listen(Number(config.port), () => {
    console.log("[wecom] HTTP 服务已启动: http://0.0.0.0:%s", config.port);
  });

  /** 8. 优雅退出 */
  const shutdown = async (signal: string): Promise<void> => {
    console.log("[wecom] 收到 %s 信号，正在关闭...", signal);
    server.close();
    await wecomClient.stop();
    store.close();
    console.log("[wecom] 已安全关闭");
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

/** 启动应用 */
main().catch((err) => {
  console.error("[wecom] 启动失败:", err);
  process.exit(1);
});

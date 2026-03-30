import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { loadConfig } from "./config.js";
import { Store } from "./store.js";
import { Router } from "./router.js";
import { WecomClient } from "./wecom/client.js";
import { registerWecomEvents } from "./wecom/event.js";
import { collectAllTools } from "./tools/index.js";
import { handleOAuthSetup, handleOAuthRedirect } from "./hub/oauth.js";
import { handleWebhook, readBody } from "./hub/webhook.js";
import { getManifestJSON, manifest } from "./hub/manifest.js";
import { HubClient } from "./hub/client.js";
import { WxToWecom } from "./bridge/wx-to-wecom.js";
import { WecomToWx } from "./bridge/wecom-to-wx.js";
import type { WecomMessageData } from "./wecom/event.js";
import type { HubEvent, ToolResult } from "./hub/types.js";

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
    config.wecomAgentId || undefined,
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

  /** 将工具定义转换为 Hub 同步格式 */
  const toolsForHub = definitions.map((t) => ({
    name: t.name,
    description: t.description,
    command: t.command,
    parameters: t.parameters,
  }));

  /**
   * 向指定安装同步工具定义
   */
  async function syncToolsToInstallation(hubUrl: string, appToken: string): Promise<void> {
    const client = new HubClient(hubUrl, appToken);
    await client.syncTools(toolsForHub);
  }

  /**
   * 启动时遍历所有已有安装，同步工具定义
   */
  async function syncToolsOnStartup(): Promise<void> {
    const installations = store.getAllInstallations();
    if (installations.length === 0) {
      console.log("[wecom] 暂无安装记录，跳过启动时工具同步");
      return;
    }

    console.log("[wecom] 启动时同步工具到 %d 个安装...", installations.length);
    for (const inst of installations) {
      try {
        await syncToolsToInstallation(inst.hubUrl, inst.appToken);
      } catch (err) {
        console.error("[wecom] 同步工具到安装 %s 失败:", inst.id, err);
      }
    }
  }

  /**
   * 处理 command 事件（同步/异步响应模式）
   * 在 SYNC_DEADLINE 内完成则同步返回，超时则异步推送
   */
  async function onCommand(event: HubEvent, installationId: string): Promise<string | ToolResult> {
    const installation = store.getInstallation(installationId);
    if (!installation) {
      return `未找到安装: ${installationId}`;
    }

    const data = event.event?.data;
    if (!data) return "缺少事件数据";

    const command = data.command as string;
    const args = (data.args as Record<string, any>) ?? {};
    const userId = data.user_id as string;

    const handler = handlers.get(command);
    if (!handler) {
      return `未知指令: ${command}`;
    }

    try {
      const result = await handler({
        installationId,
        botId: event.bot.id,
        userId,
        traceId: event.trace_id,
        args,
      });
      return result;
    } catch (err) {
      console.error(`[wecom] 工具调用失败: ${command}`, err);
      // 异步推送错误信息
      const hubClient = new HubClient(installation.hubUrl, installation.appToken);
      const to =
        (data.group as { id?: string })?.id ??
        (data.sender as { id?: string })?.id ??
        userId ??
        (data.from as string) ??
        "";
      await hubClient.sendText(to, `工具 ${command} 执行失败`, event.trace_id).catch(() => {});
      return `工具 ${command} 执行失败`;
    }
  }

  /**
   * 处理非 command 类型的 Hub 事件
   */
  async function onHubEvent(event: HubEvent): Promise<void> {
    console.log(
      `[wecom] 收到事件: type=${event.event?.type} id=${event.event?.id} trace=${event.trace_id}`,
    );

    const installation = store.getInstallation(event.installation_id);
    if (!installation) {
      console.warn(`[wecom] 未找到安装: ${event.installation_id}`);
      return;
    }

    // TODO: 根据事件类型分发处理
    console.log(`[wecom] 事件数据:`, JSON.stringify(event.event?.data));
  }

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
      const replyText = typeof cmdResult === "string" ? cmdResult : cmdResult.reply;
      await wecomClient.replyStream(msg.frame, replyText);
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

      /** OAuth 回调（传入工具定义以便同步） */
      if (pathname === "/oauth/redirect") {
        if (req.method === "GET") {
          // 模式 1: OAuth PKCE 回调
          await handleOAuthRedirect(req, res, config, store, toolsForHub);
        } else if (req.method === "POST") {
          // 模式 2: Hub 直接安装通知
          const body = await readBody(req);
          const data = JSON.parse(body);
          store.saveInstallation({
            id: data.installation_id,
            hubUrl: data.hub_url || config.hubUrl,
            appId: "",
            botId: data.bot_id || "",
            appToken: data.app_token,
            webhookSecret: data.webhook_secret,
          });
          // 异步同步 tools 到 Hub
          new HubClient(data.hub_url || config.hubUrl, data.app_token)
            .syncTools(toolsForHub)
            .catch(console.error);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ webhook_url: `${config.baseUrl}/webhook` }));
        } else {
          res.writeHead(405, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Method Not Allowed" }));
        }
        return;
      }

      /** Hub Webhook 事件接收（传入 onEvent 和 command 处理器） */
      if (pathname === "/webhook" && req.method === "POST") {
        await handleWebhook(req, res, store, onHubEvent, onCommand);
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

    // 启动后同步工具到所有已有安装
    syncToolsOnStartup().catch((err) => {
      console.error("[wecom] 启动时同步工具异常:", err);
    });
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

/**
 * OAuth2 + PKCE 安装流程（含 setup 配置页）
 *
 * 1. Hub 访问 GET /oauth/setup → 显示企业微信配置表单
 * 2. 用户填写后 POST /oauth/setup → 生成 PKCE，重定向到 Hub 授权页
 * 3. Hub 授权完成后回调 GET /oauth/redirect → 用 code + code_verifier 换取安装信息
 * 4. 成功后同步 tools + 重定向到 returnUrl
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { generatePKCE } from "../utils/crypto.js";
import type { Store } from "../store.js";
import type { Config } from "../config.js";
import type { Installation } from "./types.js";
import { HubClient } from "./client.js";
import { readBody } from "./webhook.js";

/** PKCE 缓存条目（含用户填写的企微 Key 配置） */
interface PKCEEntry {
  verifier: string;
  hub: string;
  appId: string;
  returnUrl: string;
  /** 用户在 setup 页面填写的企微凭证 */
  userConfig?: Record<string, string>;
  expiresAt: number;
}

/** PKCE 缓存，key 为 localState，10 分钟过期 */
const pkceCache = new Map<string, PKCEEntry>();

/** 缓存过期时间：10 分钟 */
const PKCE_TTL_MS = 10 * 60 * 1000;

/** 清理过期的 PKCE 条目 */
function cleanExpired(): void {
  const now = Date.now();
  for (const [key, entry] of pkceCache) {
    if (entry.expiresAt < now) {
      pkceCache.delete(key);
    }
  }
}

/**
 * 处理 OAuth 安装流程第一步：
 * GET  → 显示配置表单 HTML，让用户填写企微 Key
 * POST → 读取表单数据，生成 PKCE 并重定向到 Hub 授权页
 * 路由: GET/POST /oauth/setup
 */
export async function handleOAuthSetup(
  req: IncomingMessage,
  res: ServerResponse,
  config: Config,
): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  const params = url.searchParams;

  const hub = params.get("hub") ?? config.hubUrl;
  const appId = params.get("app_id") ?? "";
  const botId = params.get("bot_id") ?? "";
  const state = params.get("state") ?? "";
  const returnUrl = params.get("return_url") ?? "";

  // POST 请求 — 用户提交了配置表单
  if (req.method === "POST") {
    const body = await readBody(req);
    const formData = new URLSearchParams(body.toString());
    const wecomBotId = formData.get("wecom_bot_id") || "";
    const wecomBotSecret = formData.get("wecom_bot_secret") || "";
    const wecomCorpId = formData.get("wecom_corp_id") || "";
    const wecomCorpSecret = formData.get("wecom_corp_secret") || "";
    const wecomAgentId = formData.get("wecom_agent_id") || "";

    if (!hub || !appId || !botId) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "缺少必填参数: hub, app_id, bot_id" }));
      return;
    }

    // 清理过期缓存
    cleanExpired();

    // 生成 PKCE
    const { codeVerifier, codeChallenge } = generatePKCE();
    const localState = crypto.randomUUID();

    // 缓存 PKCE + 用户填的 Key
    pkceCache.set(localState, {
      verifier: codeVerifier,
      hub,
      appId,
      returnUrl,
      userConfig: {
        wecom_bot_id: wecomBotId,
        wecom_bot_secret: wecomBotSecret,
        wecom_corp_id: wecomCorpId,
        wecom_corp_secret: wecomCorpSecret,
        wecom_agent_id: wecomAgentId,
      },
      expiresAt: Date.now() + PKCE_TTL_MS,
    });

    // 重定向到 Hub 授权页
    const authorizeUrl = new URL(`/api/apps/${appId}/oauth/authorize`, hub);
    if (botId) authorizeUrl.searchParams.set("bot_id", botId);
    authorizeUrl.searchParams.set("state", localState);
    authorizeUrl.searchParams.set("code_challenge", codeChallenge);
    if (state) authorizeUrl.searchParams.set("hub_state", state);

    res.writeHead(302, { Location: authorizeUrl.toString() });
    res.end();
    return;
  }

  // GET 请求 — 显示配置表单 HTML
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>企业微信 Bridge — 配置</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f5f5f5; display: flex; justify-content: center; align-items: center; min-height: 100vh; }
    .card { background: white; border-radius: 12px; padding: 32px; max-width: 420px; width: 100%; box-shadow: 0 2px 12px rgba(0,0,0,0.1); }
    h1 { font-size: 20px; margin-bottom: 4px; }
    .desc { color: #666; font-size: 14px; margin-bottom: 24px; }
    label { display: block; font-size: 14px; font-weight: 500; margin-bottom: 6px; color: #333; }
    input { width: 100%; padding: 10px 12px; border: 1px solid #ddd; border-radius: 8px; font-size: 14px; margin-bottom: 16px; }
    input:focus { outline: none; border-color: #3370ff; }
    .required::after { content: " *"; color: red; }
    button { width: 100%; padding: 12px; background: #3370ff; color: white; border: none; border-radius: 8px; font-size: 16px; cursor: pointer; }
    button:hover { background: #2860e0; }
    .hint { font-size: 12px; color: #999; margin-top: -12px; margin-bottom: 16px; }
    a { color: #3370ff; }
    .security-notice { background: #f0f7ff; border: 1px solid #d0e3ff; border-radius: 8px; padding: 12px 16px; margin: 16px 0; font-size: 13px; color: #444; }
    .security-notice p { font-weight: 600; margin-bottom: 6px; }
    .security-notice ul { padding-left: 20px; margin: 0; }
    .security-notice li { margin-bottom: 4px; }
    .security-notice a { color: #3370ff; }
  </style>
</head>
<body>
  <div class="card">
    <h1>企业微信 Bridge</h1>
    <p class="desc">请填写您的企业微信应用凭证，用于连接企业微信 API</p>
    <form method="POST" action="/oauth/setup?hub=${encodeURIComponent(hub)}&app_id=${encodeURIComponent(appId)}&bot_id=${encodeURIComponent(botId)}&state=${encodeURIComponent(state)}&return_url=${encodeURIComponent(returnUrl)}">
      <label class="required">企微 BotID</label>
      <input name="wecom_bot_id" placeholder="智能机器人的 BotID" required />
      <p class="hint">在企业微信管理后台 → 应用管理 → 智能机器人中获取</p>

      <label class="required">Bot Secret</label>
      <input name="wecom_bot_secret" type="password" placeholder="智能机器人的 Secret" required />

      <label>企业 ID（可选）</label>
      <input name="wecom_corp_id" placeholder="用于 OpenAPI 调用" />
      <p class="hint">在企业微信管理后台 → 我的企业中查看</p>

      <label>应用 Secret（可选）</label>
      <input name="wecom_corp_secret" type="password" placeholder="自建应用的 Secret" />

      <label>AgentID（可选）</label>
      <input name="wecom_agent_id" placeholder="应用的 AgentId" />
      <p class="hint">用于发送应用消息，在应用详情页查看</p>

      <div class="security-notice">
        <p>🔒 安全说明</p>
        <ul>
          <li>您的凭证将使用 AES-256-GCM 加密后存储在 App 服务器本地，不会明文保存</li>
          <li>凭证仅用于调用对应的第三方服务，不会用于任何其他用途</li>
          <li>OpeniLink Hub 平台不会接触或存储您的第三方凭证</li>
          <li>如需更高安全性，建议<a href="https://github.com/openilink/openilink-app-wecom">自行部署</a>本 App</li>
        </ul>
      </div>
      <button type="submit">确认并安装</button>
    </form>
  </div>
</body>
</html>`;

  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

/**
 * 处理 OAuth 回调
 * GET /oauth/redirect
 *
 * 查询参数:
 *  - code: 授权码
 *  - state: 之前传出的 localState
 */
export async function handleOAuthRedirect(
  req: IncomingMessage,
  res: ServerResponse,
  config: Config,
  store: Store,
  tools?: Record<string, unknown>[],
): Promise<void> {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (!code || !state) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "缺少 code 或 state 参数" }));
    return;
  }

  // 清理过期缓存
  cleanExpired();

  const pending = pkceCache.get(state);
  if (!pending) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "无效或已过期的 state" }));
    return;
  }

  pkceCache.delete(state);

  try {
    // 用 code + code_verifier 换取安装信息
    const exchangeUrl = `${pending.hub.replace(/\/+$/, "")}/api/apps/${pending.appId}/oauth/exchange`;
    const tokenResp = await fetch(exchangeUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code,
        code_verifier: pending.verifier,
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!tokenResp.ok) {
      const errText = await tokenResp.text();
      console.error("[OAuth] 换取 token 失败:", tokenResp.status, errText);
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({ error: "Hub token 交换失败", detail: errText }),
      );
      return;
    }

    const tokenData = (await tokenResp.json()) as {
      installation_id: string;
      app_id: string;
      bot_id: string;
      app_token: string;
      webhook_secret: string;
    };

    // 持久化安装记录
    const installation: Installation = {
      id: tokenData.installation_id,
      hubUrl: pending.hub,
      appId: tokenData.app_id,
      botId: tokenData.bot_id,
      appToken: tokenData.app_token,
      webhookSecret: tokenData.webhook_secret,
      createdAt: new Date().toISOString(),
    };

    store.saveInstallation(installation);
    console.log(`[OAuth] 安装成功: ${installation.id}`);

    // 将用户在 setup 页面填写的企微 Key 加密存储到本地
    if (pending.userConfig && Object.values(pending.userConfig).some((v) => v)) {
      store.saveConfig(installation.id, pending.userConfig, installation.appToken);
      console.log("[OAuth] 用户配置已加密存储");
    }

    // 安装成功后拉取用户配置并加密存储到本地
    {
      const hubClient = new HubClient(installation.hubUrl, installation.appToken);
      try {
        const remoteConfig = await hubClient.fetchConfig();
        if (Object.keys(remoteConfig).length > 0) {
          store.saveConfig(installation.id, remoteConfig, installation.appToken);
          console.log(`[OAuth] 已拉取并加密保存配置: ${installation.id}`);
        }
      } catch (err) {
        console.error("[OAuth] 拉取配置失败:", err);
      }

      // 成功后同步工具定义到 Hub
      if (tools && tools.length > 0) {
        await hubClient.syncTools(tools).catch((err) => {
          console.error("[OAuth] 同步工具失败:", err);
        });
      }
    }

    // 重定向到 returnUrl（如果有的话），否则返回 JSON
    if (pending.returnUrl) {
      res.writeHead(302, { Location: pending.returnUrl });
      res.end();
    } else {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          ok: true,
          message: "安装成功",
          installation_id: installation.id,
        }),
      );
    }
  } catch (err) {
    console.error("[OAuth] 回调处理异常:", err);
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error: "OAuth 回调处理失败",
        detail: String(err),
      }),
    );
  }
}

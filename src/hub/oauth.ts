import type { IncomingMessage, ServerResponse } from "node:http";
import { URL } from "node:url";
import { generatePKCE } from "../utils/crypto.js";
import type { Store } from "../store.js";
import type { Config } from "../config.js";
import type { Installation } from "./types.js";
import { HubClient } from "./client.js";

/**
 * 内存中暂存 PKCE state → verifier 映射
 * 生产环境建议使用 Redis 等外部存储
 */
const pendingStates = new Map<
  string,
  { codeVerifier: string; hubUrl: string; createdAt: number }
>();

/** 定期清理过期的 state（10 分钟有效） */
const STATE_TTL_MS = 10 * 60 * 1000;

/**
 * 处理 OAuth 安装发起请求
 * GET /oauth/setup?hub_url=xxx
 * 生成 PKCE，重定向到 Hub 授权页
 */
export function handleOAuthSetup(
  req: IncomingMessage,
  res: ServerResponse,
  config: Config,
): void {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  const hubUrl = url.searchParams.get("hub_url") || config.hubUrl;

  if (!hubUrl) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "缺少 hub_url 参数" }));
    return;
  }

  const { codeVerifier, codeChallenge } = generatePKCE();

  /** 使用随机字符串作为 state 防止 CSRF */
  const state = crypto.randomUUID();
  pendingStates.set(state, {
    codeVerifier,
    hubUrl,
    createdAt: Date.now(),
  });

  /** 清理过期 state */
  cleanupExpiredStates();

  /** 构造 Hub 授权 URL */
  const redirectUri = `${config.baseUrl}/oauth/redirect`;
  const authUrl = new URL("/oauth/authorize", hubUrl);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("code_challenge", codeChallenge);
  authUrl.searchParams.set("code_challenge_method", "S256");

  res.writeHead(302, { Location: authUrl.toString() });
  res.end();
}

/**
 * 处理 OAuth 回调
 * GET /oauth/redirect?code=xxx&state=xxx
 * 用 code + code_verifier 换取 app_token，保存安装记录
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

  const pending = pendingStates.get(state);
  if (!pending) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "无效或已过期的 state" }));
    return;
  }

  pendingStates.delete(state);

  try {
    /** 向 Hub 交换 token */
    const tokenUrl = new URL("/oauth/token", pending.hubUrl);
    const tokenResp = await fetch(tokenUrl.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "authorization_code",
        code,
        code_verifier: pending.codeVerifier,
        redirect_uri: `${config.baseUrl}/oauth/redirect`,
      }),
    });

    if (!tokenResp.ok) {
      const errText = await tokenResp.text();
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

    /** 持久化安装记录 */
    const installation: Installation = {
      id: tokenData.installation_id,
      hubUrl: pending.hubUrl,
      appId: tokenData.app_id,
      botId: tokenData.bot_id,
      appToken: tokenData.app_token,
      webhookSecret: tokenData.webhook_secret,
      createdAt: new Date().toISOString(),
    };

    store.saveInstallation(installation);

    // OAuth 完成后同步工具定义到 Hub
    if (tools && tools.length > 0) {
      const hubClient = new HubClient(installation.hubUrl, installation.appToken);
      await hubClient.syncTools(tools).catch((err) => {
        console.error("[OAuth] 同步工具失败:", err);
      });
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        ok: true,
        message: "安装成功",
        installation_id: installation.id,
      }),
    );
  } catch (err) {
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error: "OAuth 回调处理失败",
        detail: String(err),
      }),
    );
  }
}

/** 清理过期的 PKCE state */
function cleanupExpiredStates(): void {
  const now = Date.now();
  for (const [key, value] of pendingStates) {
    if (now - value.createdAt > STATE_TTL_MS) {
      pendingStates.delete(key);
    }
  }
}

import AiBot from "@wecom/aibot-node-sdk";

/** 企业微信 OpenAPI 基础地址 */
const QYAPI_BASE = "https://qyapi.weixin.qq.com/cgi-bin";

/**
 * 企业微信客户端封装
 * 同时管理 WebSocket 长连接（智能机器人 SDK）和 OpenAPI（自建应用）两条通道
 */
export class WecomClient {
  private wsClient: any;
  private corpId: string;
  private corpSecret: string;
  private accessToken: string = "";
  private tokenExpiresAt: number = 0;

  /**
   * @param botId     智能机器人 BotID
   * @param botSecret 智能机器人 Secret
   * @param corpId    企业 ID（可选，用于 OpenAPI 调用）
   * @param corpSecret 应用 Secret（可选，用于 OpenAPI 调用）
   */
  constructor(
    botId: string,
    botSecret: string,
    corpId?: string,
    corpSecret?: string,
  ) {
    this.wsClient = new AiBot.WSClient({
      botId,
      secret: botSecret,
    });
    this.corpId = corpId || "";
    this.corpSecret = corpSecret || "";
  }

  /**
   * 启动 WebSocket 长连接
   */
  async start(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      /** 认证成功后 resolve */
      this.wsClient.on("authenticated", () => {
        console.log("[WecomClient] WebSocket 认证成功");
        resolve();
      });

      /** 连接错误时 reject */
      this.wsClient.on("error", (err: any) => {
        console.error("[WecomClient] WebSocket 错误:", err);
        reject(err);
      });

      this.wsClient.connect();
    });
  }

  /**
   * 停止 WebSocket 连接
   */
  async stop(): Promise<void> {
    if (this.wsClient) {
      this.wsClient.disconnect?.();
      console.log("[WecomClient] WebSocket 已断开");
    }
  }

  /**
   * 获取底层 WSClient 实例（供事件注册用）
   */
  getWSClient(): any {
    return this.wsClient;
  }

  /**
   * 通过长连接流式回复 Markdown 内容
   * @param frame   原始消息帧
   * @param content 回复内容（Markdown 格式）
   */
  async replyStream(frame: any, content: string): Promise<void> {
    /** 生成唯一 streamId */
    const streamId = `stream_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    /** 一次性发送完整内容并标记结束 */
    this.wsClient.replyStream(frame, streamId, content, true);
  }

  /**
   * 通过长连接回复模板卡片
   * @param frame 原始消息帧
   * @param card  卡片数据
   */
  async replyCard(frame: any, card: any): Promise<void> {
    this.wsClient.replyTemplateCard(frame, card);
  }

  /**
   * 获取 OpenAPI access_token（自动缓存，2 小时有效期）
   * 需要配置 corpId 和 corpSecret
   */
  async getAccessToken(): Promise<string> {
    if (!this.corpId || !this.corpSecret) {
      throw new Error("缺少 corpId 或 corpSecret，无法获取 access_token");
    }

    /** 若缓存未过期（提前 5 分钟刷新），直接返回 */
    const now = Date.now();
    if (this.accessToken && this.tokenExpiresAt > now + 5 * 60 * 1000) {
      return this.accessToken;
    }

    const url = `${QYAPI_BASE}/gettoken?corpid=${encodeURIComponent(this.corpId)}&corpsecret=${encodeURIComponent(this.corpSecret)}`;
    const resp = await fetch(url);
    const data = (await resp.json()) as {
      errcode: number;
      errmsg: string;
      access_token?: string;
      expires_in?: number;
    };

    if (data.errcode !== 0 || !data.access_token) {
      throw new Error(
        `获取 access_token 失败: [${data.errcode}] ${data.errmsg}`,
      );
    }

    this.accessToken = data.access_token;
    /** expires_in 单位为秒，转换为毫秒时间戳 */
    this.tokenExpiresAt = now + (data.expires_in || 7200) * 1000;

    console.log("[WecomClient] access_token 已刷新");
    return this.accessToken;
  }

  /**
   * 通过 OpenAPI 发送应用消息
   * @param toUser  目标用户 ID（多个用 | 分隔）
   * @param msgtype 消息类型（text / markdown / textcard 等）
   * @param content 消息内容，结构随 msgtype 变化
   */
  async sendAppMessage(
    toUser: string,
    msgtype: string,
    content: Record<string, any>,
  ): Promise<void> {
    const token = await this.getAccessToken();
    const url = `${QYAPI_BASE}/message/send?access_token=${encodeURIComponent(token)}`;

    const body = {
      touser: toUser,
      msgtype,
      agentid: 0, // 实际使用时需根据应用配置填入
      [msgtype]: content,
    };

    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = (await resp.json()) as {
      errcode: number;
      errmsg: string;
    };

    if (data.errcode !== 0) {
      throw new Error(
        `发送应用消息失败: [${data.errcode}] ${data.errmsg}`,
      );
    }
  }

  /**
   * 通过 OpenAPI 发送文本消息
   * @param toUser 目标用户 ID
   * @param text   文本内容
   */
  async sendText(toUser: string, text: string): Promise<void> {
    await this.sendAppMessage(toUser, "text", { content: text });
  }

  /**
   * 通过 OpenAPI 发送 Markdown 消息
   * @param toUser  目标用户 ID
   * @param title   标题（Markdown 模式下企业微信会忽略，仅做语义标识）
   * @param content Markdown 正文
   */
  async sendMarkdown(
    toUser: string,
    title: string,
    content: string,
  ): Promise<void> {
    await this.sendAppMessage(toUser, "markdown", { content });
  }
}

/**
 * OpeniLink Hub Bot API 客户端
 * 用于向 Hub 发送消息和文件
 */
export class HubClient {
  private hubUrl: string;
  private appToken: string;

  constructor(hubUrl: string, appToken: string) {
    this.hubUrl = hubUrl.replace(/\/+$/, "");
    this.appToken = appToken;
  }

  /**
   * 发送文本消息
   * @param installationId 安装 ID
   * @param botId Bot ID
   * @param conversationId 会话 ID
   * @param text 消息文本
   */
  async sendText(
    installationId: string,
    botId: string,
    conversationId: string,
    text: string,
  ): Promise<SendMessageResult> {
    return this.sendMessage(installationId, botId, conversationId, {
      type: "text",
      text,
    });
  }

  /**
   * 发送图片消息
   * @param installationId 安装 ID
   * @param botId Bot ID
   * @param conversationId 会话 ID
   * @param imageUrl 图片 URL
   * @param caption 图片说明（可选）
   */
  async sendImage(
    installationId: string,
    botId: string,
    conversationId: string,
    imageUrl: string,
    caption?: string,
  ): Promise<SendMessageResult> {
    return this.sendMessage(installationId, botId, conversationId, {
      type: "image",
      image_url: imageUrl,
      caption,
    });
  }

  /**
   * 发送文件消息
   * @param installationId 安装 ID
   * @param botId Bot ID
   * @param conversationId 会话 ID
   * @param fileUrl 文件 URL
   * @param fileName 文件名
   */
  async sendFile(
    installationId: string,
    botId: string,
    conversationId: string,
    fileUrl: string,
    fileName: string,
  ): Promise<SendMessageResult> {
    return this.sendMessage(installationId, botId, conversationId, {
      type: "file",
      file_url: fileUrl,
      file_name: fileName,
    });
  }

  /**
   * 通用消息发送方法
   * POST /api/v1/bots/{botId}/messages
   */
  async sendMessage(
    installationId: string,
    botId: string,
    conversationId: string,
    content: Record<string, unknown>,
  ): Promise<SendMessageResult> {
    const url = `${this.hubUrl}/api/v1/bots/${botId}/messages`;

    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.appToken}`,
        "X-Installation-Id": installationId,
      },
      body: JSON.stringify({
        conversation_id: conversationId,
        content,
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(
        `Hub API 调用失败: status=${resp.status}, body=${errText}`,
      );
    }

    const result = (await resp.json()) as SendMessageResult;
    return result;
  }
}

/** 消息发送结果 */
export interface SendMessageResult {
  ok: boolean;
  message_id?: string;
  error?: string;
}

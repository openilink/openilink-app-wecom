import type { WecomClient } from "../wecom/client.js";
import type { Store } from "../store.js";
import type { HubEvent, Installation } from "../hub/types.js";

/**
 * 微信 → 企业微信 转发桥
 * 接收 Hub 推送的微信侧事件，转发到企业微信自建应用
 */
export class WxToWecom {
  private wecomClient: WecomClient;
  private store: Store;

  constructor(wecomClient: WecomClient, store: Store) {
    this.wecomClient = wecomClient;
    this.store = store;
  }

  /**
   * 处理从 Hub 收到的微信侧事件
   * 将消息格式化为 Markdown 后通过企业微信 OpenAPI 发送
   *
   * @param event        Hub 推送的事件
   * @param installation 对应的安装记录
   */
  async handleWxEvent(
    event: HubEvent,
    installation: Installation,
  ): Promise<void> {
    /** 仅处理业务事件 */
    if (event.type !== "event" || !event.event) {
      return;
    }

    const eventData = event.event.data;
    const eventType = event.event.type;

    /** 目前只处理消息类事件 */
    if (!eventType.startsWith("message")) {
      console.log(`[WxToWecom] 跳过非消息事件: ${eventType}`);
      return;
    }

    /** 提取发送者信息 */
    const fromName = (eventData.from_name as string) || (eventData.sender_name as string) || "未知用户";
    const fromUserId = (eventData.from_user_id as string) || (eventData.sender_id as string) || "";
    const content = (eventData.content as string) || (eventData.text as string) || "";

    if (!content) {
      console.log("[WxToWecom] 消息内容为空，跳过");
      return;
    }

    /** 格式化为 Markdown */
    const markdown = `**[微信] ${fromName}**\n\n${content}`;

    /** 确定企业微信目标用户，优先查找历史关联记录 */
    const latestLink = fromUserId
      ? this.store.getLatestLinkByWxUser(fromUserId, installation.id)
      : undefined;

    /** 如果有历史关联的企业微信会话，使用对应的会话用户 */
    const targetUser = latestLink?.wecomConversation || "";

    if (!targetUser) {
      console.log(
        `[WxToWecom] 未找到微信用户 ${fromUserId} 对应的企业微信目标，跳过转发`,
      );
      return;
    }

    try {
      /** 通过 OpenAPI 发送 Markdown 消息 */
      await this.wecomClient.sendMarkdown(targetUser, "微信消息", markdown);
      console.log(
        `[WxToWecom] 已转发微信消息 -> 企业微信用户 ${targetUser}`,
      );

      /** 保存消息关联记录 */
      this.store.saveMessageLink({
        installationId: installation.id,
        wecomMsgId: event.event.id,
        wecomConversation: targetUser,
        wxUserId: fromUserId,
        wxUserName: fromName,
      });
    } catch (err) {
      console.error("[WxToWecom] 转发失败:", err);
    }
  }
}

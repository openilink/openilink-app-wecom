import type { Store } from "../store.js";
import type { Installation } from "../hub/types.js";
import type { WecomMessageData } from "../wecom/event.js";
import { HubClient } from "../hub/client.js";

/**
 * 企业微信 → 微信 转发桥
 * 接收企业微信智能机器人的消息，查找关联关系后转发到微信
 */
export class WecomToWx {
  private store: Store;

  constructor(store: Store) {
    this.store = store;
  }

  /**
   * 处理企业微信消息，转发到微信侧
   *
   * @param data          企业微信消息数据（由 event.ts 统一化后的结构）
   * @param installations 全部安装记录，用于查找 Hub 连接信息
   */
  async handleWecomMessage(
    data: WecomMessageData,
    installations: Installation[],
  ): Promise<void> {
    if (!data.content) {
      console.log("[WecomToWx] 消息内容为空，跳过");
      return;
    }

    /** 根据企业微信消息 ID 查找关联记录，遍历所有安装实例 */
    let link: import("../hub/types.js").MessageLink | undefined;
    for (const inst of installations) {
      link = this.store.getMessageLinkByWecomMsg(data.msgId, inst.id);
      if (link) break;
    }

    /** 如果没有直接的消息关联，尝试通过会话 ID 查找最近的关联 */
    if (!link) {
      for (const inst of installations) {
        const found = this.store.getLatestLinkByWxUser(data.conversationId, inst.id);
        if (found) {
          link = found;
          break;
        }
      }
    }

    if (!link) {
      console.log(
        `[WecomToWx] 未找到企业微信消息 ${data.msgId} 的关联记录，跳过转发`,
      );
      return;
    }

    /** 查找对应的安装记录 */
    const installation = installations.find(
      (inst) => inst.id === link!.installationId,
    );
    if (!installation) {
      console.log(
        `[WecomToWx] 未找到安装记录 ${link.installationId}，跳过转发`,
      );
      return;
    }

    try {
      /** 构建 HubClient 并发送消息到微信 */
      const hubClient = new HubClient(
        installation.hubUrl,
        installation.appToken,
      );

      await hubClient.sendText(link.wxUserId, data.content);

      console.log(
        `[WecomToWx] 已转发企业微信消息 -> 微信用户 ${link.wxUserId}`,
      );

      /** 保存反向关联记录 */
      this.store.saveMessageLink({
        installationId: installation.id,
        wecomMsgId: data.msgId,
        wecomConversation: data.conversationId,
        wxUserId: link.wxUserId,
        wxUserName: link.wxUserName,
      });
    } catch (err) {
      console.error("[WecomToWx] 转发失败:", err);
    }
  }
}

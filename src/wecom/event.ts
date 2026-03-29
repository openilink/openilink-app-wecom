/**
 * 企业微信消息统一数据结构
 * 将不同类型的消息（文本、图片、语音、文件）归一化为统一格式
 */
export interface WecomMessageData {
  /** 会话 ID */
  conversationId: string;
  /** 消息 ID */
  msgId: string;
  /** 消息类型：text / image / voice / file / mixed */
  msgType: string;
  /** 消息内容（文本消息为文本，其他类型为描述或 URL） */
  content: string;
  /** 发送者用户 ID */
  userId: string;
  /** 发送者用户名 */
  userName: string;
  /** 原始 frame，用于回复 */
  frame: any;
}

/**
 * 消息处理函数签名
 */
export type WecomMessageHandler = (
  data: WecomMessageData,
) => void | Promise<void>;

/**
 * 从 frame.body 中提取通用字段
 */
function extractMessageBase(frame: any): Omit<WecomMessageData, "msgType" | "content"> {
  const body = frame?.body || {};
  return {
    conversationId: body.conversation_id || body.chat_id || "",
    msgId: body.msg_id || body.message_id || "",
    userId: body.sender?.user_id || "",
    userName: body.sender?.name || "",
    frame,
  };
}

/**
 * 注册企业微信消息事件监听
 * 将 message.text / message.image / message.voice / message.file 统一回调
 *
 * @param wsClient  AiBot.WSClient 实例
 * @param onMessage 统一消息处理回调
 */
export function registerWecomEvents(
  wsClient: any,
  onMessage: WecomMessageHandler,
): void {
  /** 文本消息 */
  wsClient.on("message.text", (frame: any) => {
    const base = extractMessageBase(frame);
    const content = frame.body?.text?.content || "";
    onMessage({
      ...base,
      msgType: "text",
      content,
    });
  });

  /** 图片消息 */
  wsClient.on("message.image", (frame: any) => {
    const base = extractMessageBase(frame);
    const content = frame.body?.image?.url || "[图片]";
    onMessage({
      ...base,
      msgType: "image",
      content,
    });
  });

  /** 语音消息 */
  wsClient.on("message.voice", (frame: any) => {
    const base = extractMessageBase(frame);
    const content = frame.body?.voice?.url || "[语音]";
    onMessage({
      ...base,
      msgType: "voice",
      content,
    });
  });

  /** 文件消息 */
  wsClient.on("message.file", (frame: any) => {
    const base = extractMessageBase(frame);
    const fileName = frame.body?.file?.name || "未知文件";
    const fileUrl = frame.body?.file?.url || "";
    const content = fileUrl ? `[文件] ${fileName}: ${fileUrl}` : `[文件] ${fileName}`;
    onMessage({
      ...base,
      msgType: "file",
      content,
    });
  });

  /** 进入会话事件（仅打印日志，不触发消息回调） */
  wsClient.on("event.enter_chat", (frame: any) => {
    const userId = frame.body?.sender?.user_id || "unknown";
    console.log(`[WecomEvent] 用户 ${userId} 进入会话`);
  });
}

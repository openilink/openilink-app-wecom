import type { ToolDefinition, ToolHandler, ToolContext, ToolResult } from "./hub/types.js";

/**
 * 命令路由器
 * 将用户命令文本匹配到已注册的 Tool 并执行
 */
export class Router {
  /** 已注册的工具定义列表 */
  private tools: ToolDefinition[] = [];
  /** 命令 → 处理函数映射 */
  private handlers = new Map<string, ToolHandler>();

  /**
   * 注册一组工具及其处理函数
   * @param tools 工具定义列表
   * @param handlers 命令 → 处理函数映射
   */
  register(
    tools: ToolDefinition[],
    handlers: Map<string, ToolHandler>,
  ): void {
    for (const tool of tools) {
      this.tools.push(tool);
    }
    for (const [cmd, handler] of handlers) {
      this.handlers.set(cmd, handler);
    }
  }

  /**
   * 获取所有已注册的工具定义
   */
  getTools(): ToolDefinition[] {
    return [...this.tools];
  }

  /**
   * 处理命令文本
   * 从文本中解析出命令标识并执行对应的处理函数
   * @param text 用户输入的命令文本，格式为 "/command arg1 arg2"
   * @param ctx 工具执行上下文
   * @returns 执行结果文本，若命令未找到则返回 null
   */
  async handleCommand(
    text: string,
    ctx: Omit<ToolContext, "args">,
  ): Promise<string | ToolResult | null> {
    const trimmed = text.trim();
    if (!trimmed.startsWith("/")) {
      return null;
    }

    /** 解析命令和参数 */
    const spaceIdx = trimmed.indexOf(" ");
    const command = spaceIdx > 0 ? trimmed.slice(0, spaceIdx) : trimmed;
    const argsStr = spaceIdx > 0 ? trimmed.slice(spaceIdx + 1).trim() : "";

    const handler = this.handlers.get(command);
    if (!handler) {
      return null;
    }

    /** 尝试将参数解析为 JSON，失败则作为纯文本 */
    let args: Record<string, unknown>;
    try {
      args = argsStr ? JSON.parse(argsStr) : {};
    } catch {
      args = { text: argsStr };
    }

    return handler({ ...ctx, args });
  }

  /**
   * 查找与命令匹配的工具定义
   * @param command 命令标识，如 "/send_text"
   */
  findTool(command: string): ToolDefinition | undefined {
    return this.tools.find((t) => t.command === command);
  }
}

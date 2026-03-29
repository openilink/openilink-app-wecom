import { describe, it, expect, vi } from "vitest";
import { Router } from "../src/router.js";
import type { ToolDefinition, ToolHandler } from "../src/hub/types.js";

describe("Router", () => {
  /** 创建测试用工具 */
  function setupRouter() {
    const router = new Router();
    const tools: ToolDefinition[] = [
      { name: "echo", description: "回显消息", command: "/echo" },
      { name: "greet", description: "打招呼", command: "/greet" },
    ];
    const handlers = new Map<string, ToolHandler>();
    handlers.set("/echo", async (ctx) => `回显: ${ctx.args.text ?? ""}`);
    handlers.set("/greet", async (ctx) => `你好, ${ctx.args.name ?? "世界"}`);
    router.register(tools, handlers);
    return router;
  }

  const baseCtx = {
    installationId: "inst-1",
    botId: "bot-1",
    userId: "user-1",
    traceId: "trace-1",
  };

  describe("register & getTools", () => {
    it("注册后能获取所有工具定义", () => {
      const router = setupRouter();
      const tools = router.getTools();
      expect(tools.length).toBe(2);
      expect(tools.map((t) => t.name)).toContain("echo");
      expect(tools.map((t) => t.name)).toContain("greet");
    });

    it("getTools 返回副本不影响内部状态", () => {
      const router = setupRouter();
      const tools = router.getTools();
      tools.push({ name: "injected", description: "注入", command: "/injected" });
      expect(router.getTools().length).toBe(2);
    });
  });

  describe("handleCommand", () => {
    it("非 / 开头的文本返回 null", async () => {
      const router = setupRouter();
      const result = await router.handleCommand("hello world", baseCtx);
      expect(result).toBeNull();
    });

    it("空字符串返回 null", async () => {
      const router = setupRouter();
      const result = await router.handleCommand("", baseCtx);
      expect(result).toBeNull();
    });

    it("未注册的命令返回 null", async () => {
      const router = setupRouter();
      const result = await router.handleCommand("/unknown arg1", baseCtx);
      expect(result).toBeNull();
    });

    it("匹配命令并执行处理函数", async () => {
      const router = setupRouter();
      const result = await router.handleCommand("/echo 测试消息", baseCtx);
      expect(result).toBe("回显: 测试消息");
    });

    it("无参数命令也能正确执行", async () => {
      const router = setupRouter();
      const result = await router.handleCommand("/echo", baseCtx);
      expect(result).toBe("回显: ");
    });

    it("支持 JSON 格式参数", async () => {
      const router = setupRouter();
      const result = await router.handleCommand(
        '/greet {"name":"张三"}',
        baseCtx,
      );
      expect(result).toBe("你好, 张三");
    });

    it("非 JSON 参数作为纯文本传入 args.text", async () => {
      const router = setupRouter();
      const result = await router.handleCommand("/echo plain text", baseCtx);
      expect(result).toBe("回显: plain text");
    });

    it("处理前后空格", async () => {
      const router = setupRouter();
      const result = await router.handleCommand("  /echo   带空格  ", baseCtx);
      expect(result).toBe("回显: 带空格");
    });
  });

  describe("findTool", () => {
    it("找到已注册的工具", () => {
      const router = setupRouter();
      const tool = router.findTool("/echo");
      expect(tool).toBeDefined();
      expect(tool!.name).toBe("echo");
    });

    it("找不到未注册的命令返回 undefined", () => {
      const router = setupRouter();
      const tool = router.findTool("/not-exist");
      expect(tool).toBeUndefined();
    });
  });
});

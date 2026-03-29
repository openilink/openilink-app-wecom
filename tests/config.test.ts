import { describe, it, expect } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  /** 辅助函数：构造 getenv */
  function makeEnv(overrides: Record<string, string> = {}) {
    const base: Record<string, string> = {
      HUB_URL: "https://hub.example.com",
      BASE_URL: "https://app.example.com",
      WECOM_BOT_ID: "bot-123",
      WECOM_BOT_SECRET: "secret-456",
    };
    const merged = { ...base, ...overrides };
    return (key: string) => merged[key];
  }

  it("使用默认端口 8085", () => {
    const config = loadConfig(makeEnv());
    expect(config.port).toBe("8085");
  });

  it("使用默认数据库路径 data/wecom.db", () => {
    const config = loadConfig(makeEnv());
    expect(config.dbPath).toBe("data/wecom.db");
  });

  it("允许通过环境变量自定义端口", () => {
    const config = loadConfig(makeEnv({ PORT: "9090" }));
    expect(config.port).toBe("9090");
  });

  it("允许通过环境变量自定义数据库路径", () => {
    const config = loadConfig(makeEnv({ DB_PATH: "/tmp/test.db" }));
    expect(config.dbPath).toBe("/tmp/test.db");
  });

  it("可选字段 corpId 和 corpSecret 默认为空字符串", () => {
    const config = loadConfig(makeEnv());
    expect(config.wecomCorpId).toBe("");
    expect(config.wecomCorpSecret).toBe("");
  });

  it("自动 trim 环境变量前后空格", () => {
    const config = loadConfig(
      makeEnv({
        PORT: "  7777  ",
        HUB_URL: "  https://hub.example.com  ",
      }),
    );
    expect(config.port).toBe("7777");
    expect(config.hubUrl).toBe("https://hub.example.com");
  });

  it("缺少 HUB_URL 时抛出错误", () => {
    const env = makeEnv();
    expect(() => loadConfig((k) => (k === "HUB_URL" ? undefined : env(k)))).toThrow(
      "缺少必填配置项",
    );
  });

  it("缺少 BASE_URL 时抛出错误", () => {
    const env = makeEnv();
    expect(() => loadConfig((k) => (k === "BASE_URL" ? undefined : env(k)))).toThrow(
      "缺少必填配置项",
    );
  });

  it("缺少 WECOM_BOT_ID 时抛出错误", () => {
    const env = makeEnv();
    expect(() => loadConfig((k) => (k === "WECOM_BOT_ID" ? undefined : env(k)))).toThrow(
      "缺少必填配置项",
    );
  });

  it("缺少 WECOM_BOT_SECRET 时抛出错误", () => {
    const env = makeEnv();
    expect(() => loadConfig((k) => (k === "WECOM_BOT_SECRET" ? undefined : env(k)))).toThrow(
      "缺少必填配置项",
    );
  });

  it("同时缺少多个必填项时全部列出", () => {
    expect(() => loadConfig(() => undefined)).toThrow(
      /hubUrl.*baseUrl.*wecomBotId.*wecomBotSecret/,
    );
  });
});

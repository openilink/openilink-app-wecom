import { describe, it, expect } from "vitest";
import { manifest, getManifestJSON } from "../../src/hub/manifest.js";

describe("manifest", () => {
  it("包含正确的应用 slug", () => {
    expect(manifest.slug).toBe("wecom-bridge");
  });

  it("包含应用名称", () => {
    expect(manifest.name).toBeDefined();
    expect(typeof manifest.name).toBe("string");
    expect(manifest.name.length).toBeGreaterThan(0);
  });

  it("包含应用描述", () => {
    expect(manifest.description).toBeDefined();
    expect(manifest.description.length).toBeGreaterThan(0);
  });

  it("声明支持的事件类型列表", () => {
    expect(Array.isArray(manifest.events)).toBe(true);
    expect(manifest.events).toContain("message");
    expect(manifest.events).toContain("command");
  });

  it("tools 默认为空数组（运行时动态注入）", () => {
    /** tools 在 index.ts 中运行时注入，这里测试初始值 */
    expect(Array.isArray(manifest.tools)).toBe(true);
  });
});

describe("getManifestJSON", () => {
  it("返回合法的 JSON 字符串", () => {
    const json = getManifestJSON();
    expect(() => JSON.parse(json)).not.toThrow();
  });

  it("返回的 JSON 包含 slug 字段", () => {
    const parsed = JSON.parse(getManifestJSON());
    expect(parsed.slug).toBe("wecom-bridge");
  });

  it("返回的 JSON 包含 events 字段", () => {
    const parsed = JSON.parse(getManifestJSON());
    expect(Array.isArray(parsed.events)).toBe(true);
  });
});

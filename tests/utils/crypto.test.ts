import { describe, it, expect } from "vitest";
import { createHmac, createHash } from "node:crypto";
import { verifySignature, generatePKCE } from "../../src/utils/crypto.js";

describe("verifySignature", () => {
  const secret = "test-secret";
  const payload = '{"type":"event","trace_id":"123"}';

  /** 计算正确签名 */
  function sign(s: string, p: string): string {
    return createHmac("sha256", s).update(p).digest("hex");
  }

  it("签名合法时返回 true", () => {
    const sig = sign(secret, payload);
    expect(verifySignature(secret, payload, sig)).toBe(true);
  });

  it("签名不匹配时返回 false", () => {
    expect(verifySignature(secret, payload, "bad-signature")).toBe(false);
  });

  it("空签名返回 false", () => {
    expect(verifySignature(secret, payload, "")).toBe(false);
  });

  it("不同 secret 产生的签名不匹配", () => {
    const sig = sign("other-secret", payload);
    expect(verifySignature(secret, payload, sig)).toBe(false);
  });

  it("不同 payload 产生的签名不匹配", () => {
    const sig = sign(secret, "different-payload");
    expect(verifySignature(secret, payload, sig)).toBe(false);
  });

  it("签名长度不一致时直接返回 false", () => {
    /** 只有 10 个字符，比正常 sha256 hex 短 */
    expect(verifySignature(secret, payload, "abcdef1234")).toBe(false);
  });
});

describe("generatePKCE", () => {
  it("返回 codeVerifier 和 codeChallenge", () => {
    const { codeVerifier, codeChallenge } = generatePKCE();
    expect(codeVerifier).toBeDefined();
    expect(codeChallenge).toBeDefined();
    expect(typeof codeVerifier).toBe("string");
    expect(typeof codeChallenge).toBe("string");
  });

  it("codeVerifier 长度在合理范围内（32-128 字符）", () => {
    const { codeVerifier } = generatePKCE();
    expect(codeVerifier.length).toBeGreaterThanOrEqual(32);
    expect(codeVerifier.length).toBeLessThanOrEqual(128);
  });

  it("codeChallenge 是 codeVerifier 的 SHA-256 Base64url 编码", () => {
    const { codeVerifier, codeChallenge } = generatePKCE();
    const expected = createHash("sha256").update(codeVerifier).digest("base64url");
    expect(codeChallenge).toBe(expected);
  });

  it("每次调用生成不同的值", () => {
    const a = generatePKCE();
    const b = generatePKCE();
    expect(a.codeVerifier).not.toBe(b.codeVerifier);
    expect(a.codeChallenge).not.toBe(b.codeChallenge);
  });

  it("codeVerifier 仅包含 URL-safe 字符", () => {
    for (let i = 0; i < 10; i++) {
      const { codeVerifier } = generatePKCE();
      expect(codeVerifier).toMatch(/^[a-zA-Z0-9\-._~]+$/);
    }
  });
});

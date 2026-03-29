import { createHmac, randomBytes, createHash, timingSafeEqual } from "node:crypto";

/**
 * 使用 HMAC-SHA256 + timingSafeEqual 验证 Webhook 签名
 * @param secret   签名密钥
 * @param payload  请求体原文
 * @param signature 请求头中附带的签名（hex 编码）
 * @returns 签名是否合法
 */
export function verifySignature(
  secret: string,
  payload: string,
  signature: string,
): boolean {
  const expected = createHmac("sha256", secret).update(payload).digest("hex");

  /** 长度不一致直接拒绝，避免 timingSafeEqual 抛异常 */
  if (expected.length !== signature.length) {
    return false;
  }

  return timingSafeEqual(
    Buffer.from(expected, "utf-8"),
    Buffer.from(signature, "utf-8"),
  );
}

/**
 * 生成 OAuth PKCE 所需的 code_verifier 和 code_challenge
 * @returns { codeVerifier, codeChallenge } 均为 URL-safe Base64 编码
 */
export function generatePKCE(): {
  codeVerifier: string;
  codeChallenge: string;
} {
  /** 生成 32 字节随机 code_verifier（编码后 43 字符） */
  const codeVerifier = randomBytes(32)
    .toString("base64url")
    .replace(/[^a-zA-Z0-9\-._~]/g, "");

  /** S256 变换：SHA-256(code_verifier) → Base64url */
  const codeChallenge = createHash("sha256")
    .update(codeVerifier)
    .digest("base64url");

  return { codeVerifier, codeChallenge };
}

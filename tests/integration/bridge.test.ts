import { describe, it, expect, beforeEach } from "vitest";
import { injectMessage, getMessages, resetMock, waitFor } from "./setup";

/**
 * 企业微信 App 桥接集成测试
 * 需要手动启动 Mock Server 和 App 服务后才能运行
 *
 * 启动步骤：
 * 1. 启动 Mock Server:
 *    go run github.com/openilink/openilink-hub/cmd/appmock@latest \
 *      --listen :9801 --webhook-url http://localhost:8085/hub/webhook --app-token mock_app_token
 * 2. 启动 App:
 *    WECOM_BOT_ID=mock_bot_id WECOM_BOT_SECRET=mock_bot_secret npm run dev
 * 3. 运行测试:
 *    npm run test:integration
 */
describe.skip("Bridge 集成测试（需启动 Mock Server + App）", () => {
  // 每个测试前重置 Mock Server 状态
  beforeEach(async () => {
    await resetMock();
  });

  it("企业微信文本消息应被 App 处理", async () => {
    await injectMessage("user_alice", "你好");
    await waitFor(async () => (await getMessages()).length > 0);
    const msgs = await getMessages();
    expect(msgs.length).toBeGreaterThan(0);
  });

  it("Mock Server 应记录 App 的回复", async () => {
    await injectMessage("user_alice", "测试消息");
    await waitFor(async () => (await getMessages()).length > 0);
    const msgs = await getMessages();
    expect(msgs.length).toBeGreaterThan(0);
  });
});

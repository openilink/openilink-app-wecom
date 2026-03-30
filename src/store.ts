import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Installation, MessageLink } from "./hub/types.js";
import { encryptConfig, decryptConfig } from "./utils/config-crypto.js";

/**
 * SQLite 持久化存储
 * 管理安装记录 (installations) 和消息关联 (message_links) 两张表
 */
export class Store {
  private db: Database.Database;

  constructor(dbPath: string) {
    /** 确保数据库目录存在 */
    mkdirSync(dirname(dbPath), { recursive: true });

    this.db = new Database(dbPath);
    /** 开启 WAL 模式以提升并发读写性能 */
    this.db.pragma("journal_mode = WAL");
    this.migrate();
  }

  /** 建表迁移 */
  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS installations (
        id            TEXT PRIMARY KEY,
        hub_url       TEXT NOT NULL,
        app_id        TEXT NOT NULL,
        bot_id        TEXT NOT NULL,
        app_token     TEXT NOT NULL,
        webhook_secret TEXT NOT NULL,
        created_at    TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS message_links (
        id                  INTEGER PRIMARY KEY AUTOINCREMENT,
        installation_id     TEXT NOT NULL,
        wecom_msg_id        TEXT NOT NULL,
        wecom_conversation  TEXT NOT NULL,
        wx_user_id          TEXT NOT NULL,
        wx_user_name        TEXT NOT NULL DEFAULT '',
        created_at          TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (installation_id) REFERENCES installations(id)
      );

      CREATE INDEX IF NOT EXISTS idx_message_links_wecom_msg
        ON message_links(wecom_msg_id);
      CREATE INDEX IF NOT EXISTS idx_message_links_wx_user
        ON message_links(wx_user_id);
    `);

    /** 追加 encrypted_config 列（已有表平滑迁移） */
    try {
      this.db.exec(`ALTER TABLE installations ADD COLUMN encrypted_config TEXT NOT NULL DEFAULT ''`);
    } catch {
      // 列已存在则忽略
    }
  }

  /* ======================== installations CRUD ======================== */

  /** 保存或更新安装记录 */
  saveInstallation(inst: Installation): void {
    const stmt = this.db.prepare(`
      INSERT INTO installations (id, hub_url, app_id, bot_id, app_token, webhook_secret, created_at)
      VALUES (@id, @hubUrl, @appId, @botId, @appToken, @webhookSecret, @createdAt)
      ON CONFLICT(id) DO UPDATE SET
        hub_url        = excluded.hub_url,
        app_id         = excluded.app_id,
        bot_id         = excluded.bot_id,
        app_token      = excluded.app_token,
        webhook_secret = excluded.webhook_secret
    `);
    stmt.run({
      id: inst.id,
      hubUrl: inst.hubUrl,
      appId: inst.appId,
      botId: inst.botId,
      appToken: inst.appToken,
      webhookSecret: inst.webhookSecret,
      createdAt: inst.createdAt || new Date().toISOString(),
    });
  }

  /** 根据 ID 查询安装记录 */
  getInstallation(id: string): Installation | undefined {
    const row = this.db
      .prepare("SELECT * FROM installations WHERE id = ?")
      .get(id) as InstallationRow | undefined;
    return row ? rowToInstallation(row) : undefined;
  }

  /** 查询全部安装记录 */
  getAllInstallations(): Installation[] {
    const rows = this.db
      .prepare("SELECT * FROM installations ORDER BY created_at DESC")
      .all() as InstallationRow[];
    return rows.map(rowToInstallation);
  }

  /* ======================== message_links CRUD ======================== */

  /** 保存消息关联记录 */
  saveMessageLink(link: MessageLink): number {
    const stmt = this.db.prepare(`
      INSERT INTO message_links (installation_id, wecom_msg_id, wecom_conversation, wx_user_id, wx_user_name, created_at)
      VALUES (@installationId, @wecomMsgId, @wecomConversation, @wxUserId, @wxUserName, @createdAt)
    `);
    const result = stmt.run({
      installationId: link.installationId,
      wecomMsgId: link.wecomMsgId,
      wecomConversation: link.wecomConversation,
      wxUserId: link.wxUserId,
      wxUserName: link.wxUserName,
      createdAt: link.createdAt || new Date().toISOString(),
    });
    return Number(result.lastInsertRowid);
  }

  /** 根据企业微信消息 ID 和安装实例 ID 查询关联记录 */
  getMessageLinkByWecomMsg(wecomMsgId: string, installationId: string): MessageLink | undefined {
    const row = this.db
      .prepare("SELECT * FROM message_links WHERE wecom_msg_id = ? AND installation_id = ? LIMIT 1")
      .get(wecomMsgId, installationId) as MessageLinkRow | undefined;
    return row ? rowToMessageLink(row) : undefined;
  }

  /** 查询某微信用户在指定安装实例下的最新关联记录 */
  getLatestLinkByWxUser(wxUserId: string, installationId: string): MessageLink | undefined {
    const row = this.db
      .prepare(
        "SELECT * FROM message_links WHERE wx_user_id = ? AND installation_id = ? ORDER BY created_at DESC LIMIT 1",
      )
      .get(wxUserId, installationId) as MessageLinkRow | undefined;
    return row ? rowToMessageLink(row) : undefined;
  }

  /* ======================== encrypted_config CRUD ======================== */

  /**
   * 将配置加密后保存到对应安装记录
   * @param installationId - 安装实例 ID
   * @param plainConfig    - 明文配置对象
   * @param appToken       - 用于派生加密密钥的 app_token
   */
  saveConfig(installationId: string, plainConfig: Record<string, string>, appToken: string): void {
    const cipher = encryptConfig(plainConfig, appToken);
    this.db
      .prepare("UPDATE installations SET encrypted_config = ? WHERE id = ?")
      .run(cipher, installationId);
  }

  /**
   * 读取并解密指定安装的配置
   * @param installationId - 安装实例 ID
   * @param appToken       - 用于派生解密密钥的 app_token
   * @returns 解密后的配置对象，若无配置则返回 undefined
   */
  getConfig(installationId: string, appToken: string): Record<string, string> | undefined {
    const row = this.db
      .prepare("SELECT encrypted_config FROM installations WHERE id = ?")
      .get(installationId) as { encrypted_config: string } | undefined;
    if (!row || !row.encrypted_config) return undefined;
    return decryptConfig(row.encrypted_config, appToken);
  }

  /** 关闭数据库连接 */
  close(): void {
    this.db.close();
  }
}

/* ======================== 内部行类型映射 ======================== */

interface InstallationRow {
  id: string;
  hub_url: string;
  app_id: string;
  bot_id: string;
  app_token: string;
  webhook_secret: string;
  created_at: string;
}

interface MessageLinkRow {
  id: number;
  installation_id: string;
  wecom_msg_id: string;
  wecom_conversation: string;
  wx_user_id: string;
  wx_user_name: string;
  created_at: string;
}

function rowToInstallation(row: InstallationRow): Installation {
  return {
    id: row.id,
    hubUrl: row.hub_url,
    appId: row.app_id,
    botId: row.bot_id,
    appToken: row.app_token,
    webhookSecret: row.webhook_secret,
    createdAt: row.created_at,
  };
}

function rowToMessageLink(row: MessageLinkRow): MessageLink {
  return {
    id: row.id,
    installationId: row.installation_id,
    wecomMsgId: row.wecom_msg_id,
    wecomConversation: row.wecom_conversation,
    wxUserId: row.wx_user_id,
    wxUserName: row.wx_user_name,
    createdAt: row.created_at,
  };
}

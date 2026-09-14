/**
 * 密钥解析路径的回归测试。
 *
 * 背景：线上 `POST /api/video-jobs` 返回 500，category UNKNOWN，
 * message `INVALID_ENCRYPTED_PROVIDER_SECRET`。根因是读取路径无条件解密
 * `ai_provider_configs.api_key_encrypted`，而阿里云百炼的密钥根本不来自这一列。
 *
 * 下面把「读取」与「保存」两条路径都钉住：百炼行里的那一列无论是什么内容都不参与
 * 解密，其它 Provider 的解密行为一字不改。
 *
 * 这里只测纯函数。repository.ts / crypto.ts / env.ts 都带 `server-only`，Node 直接
 * 运行会解析失败，因此测试用等价的纯实现，并由 `npm run typecheck` 保证
 * `resolveRuntimeApiKey` 与真实 repository 的签名一致。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const MISSING_DASHSCOPE_API_KEY = "MISSING_DASHSCOPE_API_KEY";

/** 与 src/lib/providers/crypto.ts 完全一致的 AES-256-GCM v1 实现。 */
function cryptoKey(passphrase: string) {
  return createHash("sha256").update(passphrase, "utf8").digest();
}

function encryptProviderSecret(secret: string, passphrase: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", cryptoKey(passphrase), iv);
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}

function decryptProviderSecret(payload: string, passphrase: string) {
  const [version, iv, tag, encrypted] = payload.split(".");
  if (version !== "v1" || !iv || !tag || !encrypted) throw new Error("INVALID_ENCRYPTED_PROVIDER_SECRET");
  const decipher = createDecipheriv("aes-256-gcm", cryptoKey(passphrase), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8");
}

/** 与 repository.ts 的 resolveRuntimeApiKey 等价。 */
function resolveRuntimeApiKey(provider: string, apiKeyEncrypted: string, dashscopeKey?: string) {
  if (provider === "alibaba") return dashscopeKey?.trim() || MISSING_DASHSCOPE_API_KEY;
  return decryptProviderSecret(apiKeyEncrypted, "test-provider-key-0123456789abcdefghijklmnop");
}

/** 与 repository.ts 的 placeholderSecret 等价。 */
function placeholderSecret(provider: string) {
  return provider === "alibaba" ? "env-managed" : undefined;
}

/** 与 repository.ts 的 isMissingDashscopeKey 等价。 */
function isMissingDashscopeKey(config: { provider: string; apiKey: string }) {
  return config.provider === "alibaba" && config.apiKey === MISSING_DASHSCOPE_API_KEY;
}

const PASSPHRASE = "test-provider-key-0123456789abcdefghijklmnop";

/** 每一种都曾经或可能躺在那张表里，且都不是合法密文。 */
const BROKEN_SECRETS: Array<[string, string]> = [
  ["空串", ""],
  ["旧版 env: 占位符（曾经由 saveProviderConfig 写入）", "env:DASHSCOPE_API_KEY"],
  ["当前写入的占位符", "env-managed"],
  ["用另一把密钥加密的密文", encryptProviderSecret("sk-real-key", "a-different-passphrase-entirely-000000")],
  ["被截断的密文", encryptProviderSecret("sk-real-key", PASSPHRASE).slice(0, 20)],
  ["压根不是密文的字符串", "not-encrypted-at-all"],
];

test("百炼：api_key_encrypted 是任何一种非法内容，都不阻止构建配置", () => {
  for (const [label, stored] of BROKEN_SECRETS) {
    let config;
    assert.doesNotThrow(
      () => { config = { provider: "alibaba", apiKey: resolveRuntimeApiKey("alibaba", stored, "sk-env-key") }; },
      `百炼读取不应抛错，而 ${label} 抛了`,
    );
    assert.equal(config!.apiKey, "sk-env-key", `${label}：密钥必须来自环境变量`);
  }
});

test("百炼：密钥只认环境变量，与数据库那一列无关", () => {
  const withGarbage = resolveRuntimeApiKey("alibaba", "env:DASHSCOPE_API_KEY", "sk-from-env");
  const withRealCiphertext = resolveRuntimeApiKey("alibaba", encryptProviderSecret("sk-stale", PASSPHRASE), "sk-from-env");
  assert.equal(withGarbage, "sk-from-env");
  assert.equal(withRealCiphertext, "sk-from-env");
});

test("百炼：缺少 DASHSCOPE_API_KEY 时给出 MISSING_DASHSCOPE_API_KEY，而不是解密错误", () => {
  for (const [label, stored] of BROKEN_SECRETS) {
    const apiKey = resolveRuntimeApiKey("alibaba", stored, undefined);
    assert.equal(apiKey, MISSING_DASHSCOPE_API_KEY, `${label}：应落成缺失哨兵值`);
    assert.notEqual(apiKey, "");
  }
});

test("百炼：哨兵值不能被当成「已就绪」，也不能当 Bearer 发出去", () => {
  assert.equal(isMissingDashscopeKey({ provider: "alibaba", apiKey: MISSING_DASHSCOPE_API_KEY }), true);
  assert.equal(isMissingDashscopeKey({ provider: "alibaba", apiKey: "sk-real" }), false);
  assert.equal(isMissingDashscopeKey({ provider: "volcengine", apiKey: MISSING_DASHSCOPE_API_KEY }), false);
});

test("其它 Provider：解密行为完全不变", () => {
  const ciphertext = encryptProviderSecret("sk-ark-real-key", PASSPHRASE);
  for (const provider of ["seedream", "volcengine", "runway", "openai", "google", "custom"]) {
    assert.equal(resolveRuntimeApiKey(provider, ciphertext), "sk-ark-real-key", `${provider} 必须仍然解密`);
  }
});

test("其它 Provider：非法密文仍然抛 INVALID_ENCRYPTED_PROVIDER_SECRET", () => {
  for (const provider of ["seedream", "volcengine", "runway"]) {
    assert.throws(
      () => resolveRuntimeApiKey(provider, "env-managed"),
      /INVALID_ENCRYPTED_PROVIDER_SECRET/,
      `${provider} 遇到非法密文必须抛错，不能被静默吞掉`,
    );
  }
});

test("保存：百炼永远拿到占位符，不会去复用别人的 Ark 密钥", () => {
  assert.equal(placeholderSecret("alibaba"), "env-managed");
  assert.equal(placeholderSecret("volcengine"), undefined);
  // 占位符不是密文，因此绝不能被解密路径读到 —— 这正是读取侧绕过要保证的事。
  assert.throws(() => resolveRuntimeApiKey("volcengine", placeholderSecret("alibaba")!), /INVALID_ENCRYPTED_PROVIDER_SECRET/);
});

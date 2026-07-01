import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ENCRYPTION_VERSION = "v1";
const ENCRYPTION_ALGORITHM = "aes-256-gcm";

function parseKeyringJson() {
  const raw = String(process.env.DATASOURCE_KEYRING_JSON || "").trim();
  if (!raw) {
    throw new Error(
      "DATASOURCE_KEYRING_JSON is required for datasource credential encryption",
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (_error) {
    throw new Error("DATASOURCE_KEYRING_JSON must be valid JSON");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("DATASOURCE_KEYRING_JSON must be an object map");
  }

  const keyring = {};
  for (const [keyId, base64Key] of Object.entries(parsed)) {
    if (!keyId || typeof keyId !== "string") {
      continue;
    }
    const normalized = String(base64Key || "").trim();
    if (!normalized) {
      continue;
    }
    const key = Buffer.from(normalized, "base64");
    if (key.length !== 32) {
      throw new Error(
        `Invalid datasource key length for keyId='${keyId}'. Expected 32 bytes base64 for AES-256-GCM.`,
      );
    }
    keyring[keyId] = key;
  }

  if (Object.keys(keyring).length === 0) {
    throw new Error(
      "DATASOURCE_KEYRING_JSON does not contain any valid 32-byte keys",
    );
  }

  return keyring;
}

function getActiveKeyId() {
  const keyId = String(process.env.DATASOURCE_ACTIVE_KEY_ID || "").trim();
  if (!keyId) {
    throw new Error("DATASOURCE_ACTIVE_KEY_ID is required");
  }
  return keyId;
}

function loadCryptoConfig() {
  const keyring = parseKeyringJson();
  const activeKeyId = getActiveKeyId();
  const activeKey = keyring[activeKeyId];
  if (!activeKey) {
    throw new Error(
      `DATASOURCE_ACTIVE_KEY_ID='${activeKeyId}' is not present in DATASOURCE_KEYRING_JSON`,
    );
  }
  return { keyring, activeKeyId, activeKey };
}

export function validateDataSourceCryptoConfig() {
  loadCryptoConfig();
}

export function encryptDataSourcePassword(password) {
  const plaintext = String(password ?? "");
  if (!plaintext) {
    throw new Error("Datasource password is required for encryption");
  }

  const { activeKeyId, activeKey } = loadCryptoConfig();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ENCRYPTION_ALGORITHM, activeKey, iv);
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(plaintext, "utf8")),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return {
    v: ENCRYPTION_VERSION,
    alg: ENCRYPTION_ALGORITHM,
    keyId: activeKeyId,
    iv: iv.toString("base64"),
    ct: ciphertext.toString("base64"),
    tag: tag.toString("base64"),
    createdAt: new Date().toISOString(),
  };
}

export function decryptDataSourcePassword(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid encrypted datasource payload");
  }

  const algorithm = String(payload.alg || "");
  if (algorithm !== ENCRYPTION_ALGORITHM) {
    throw new Error("Unsupported datasource encryption algorithm");
  }

  const keyId = String(payload.keyId || "");
  if (!keyId) {
    throw new Error("Encrypted datasource payload is missing keyId");
  }

  const { keyring } = loadCryptoConfig();
  const key = keyring[keyId];
  if (!key) {
    throw new Error(`No datasource decryption key found for keyId='${keyId}'`);
  }

  const iv = Buffer.from(String(payload.iv || ""), "base64");
  const ct = Buffer.from(String(payload.ct || ""), "base64");
  const tag = Buffer.from(String(payload.tag || ""), "base64");

  const decipher = createDecipheriv(ENCRYPTION_ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ct), decipher.final()]);
  return plaintext.toString("utf8");
}

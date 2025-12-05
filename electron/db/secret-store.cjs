const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const adapter = require("./adapter.cjs");

// Machine-bound master key file approach (Variant B)
// - MK is a 32-byte random secret saved to ~/.quantbot/master.key with mode 0600
// - Secrets are encrypted with AES-256-GCM using MK and stored in DB `secrets` table

const APP_DIR = path.join(os.homedir(), ".quantbot");
const MK_FILENAME = "master.key";
const MK_PATH = path.join(APP_DIR, MK_FILENAME);

function ensureDir() {
  try {
    fs.mkdirSync(APP_DIR, { recursive: true, mode: 0o700 });
  } catch (e) {
    // ignore
  }
}

function ensureMasterKeyExists() {
  ensureDir();
  try {
    if (!fs.existsSync(MK_PATH)) {
      const mk = crypto.randomBytes(32);
      // write file with restricted mode
      fs.writeFileSync(MK_PATH, mk.toString("base64"), {
        mode: 0o600,
        flag: "wx",
      });
      return mk;
    }
    // if exists, ensure mode is 0600
    try {
      fs.chmodSync(MK_PATH, 0o600);
    } catch (e) {
      // ignore chmod errors on some platforms
    }
    const data = fs.readFileSync(MK_PATH, "utf8");
    return Buffer.from(data, "base64");
  } catch (e) {
    throw new Error(
      `Failed to ensure master key: ${e && e.message ? e.message : e}`
    );
  }
}

function readMasterKey() {
  if (!fs.existsSync(MK_PATH)) return null;
  try {
    const data = fs.readFileSync(MK_PATH, "utf8");
    return Buffer.from(data, "base64");
  } catch (e) {
    return null;
  }
}

function encryptWithMk(mkBuffer, plaintext) {
  if (!Buffer.isBuffer(mkBuffer) || mkBuffer.length !== 32) {
    throw new Error("Invalid master key length");
  }
  const iv = crypto.randomBytes(12); // recommended for GCM
  const cipher = crypto.createCipheriv("aes-256-gcm", mkBuffer, iv);
  const ct = Buffer.concat([
    cipher.update(Buffer.from(String(plaintext), "utf8")),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return JSON.stringify({
    v: 1,
    alg: "AES-256-GCM",
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    ct: ct.toString("base64"),
  });
}

function decryptWithMk(mkBuffer, payloadJson) {
  const payload =
    typeof payloadJson === "string" ? JSON.parse(payloadJson) : payloadJson;
  if (!payload || !payload.ct || !payload.iv || !payload.tag)
    throw new Error("Invalid payload");
  const iv = Buffer.from(payload.iv, "base64");
  const tag = Buffer.from(payload.tag, "base64");
  const ct = Buffer.from(payload.ct, "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", mkBuffer, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(ct), decipher.final()]);
  return plain.toString("utf8");
}

async function saveSecret(keyName, plaintext) {
  if (!keyName) throw new Error("keyName required");
  const mk = ensureMasterKeyExists();
  const payload = encryptWithMk(mk, plaintext);
  // upsert into secrets table
  try {
    const stmt = adapter.db.prepare(
      "INSERT INTO secrets(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=CURRENT_TIMESTAMP"
    );
    stmt.run(keyName, payload);
    return true;
  } catch (e) {
    throw e;
  }
}

async function getSecret(keyName) {
  if (!keyName) return null;
  try {
    const row = adapter.db
      .prepare("SELECT value FROM secrets WHERE key = ?")
      .get(keyName);
    if (!row || !row.value) return null;
    const mk = ensureMasterKeyExists();
    try {
      return decryptWithMk(mk, row.value);
    } catch (err) {
      throw new Error(
        "Decryption failed: " + (err && err.message ? err.message : err)
      );
    }
  } catch (e) {
    throw e;
  }
}

async function deleteSecret(keyName) {
  if (!keyName) return false;
  try {
    adapter.db.prepare("DELETE FROM secrets WHERE key = ?").run(keyName);
    return true;
  } catch (e) {
    throw e;
  }
}

module.exports = {
  MK_PATH,
  ensureMasterKeyExists,
  readMasterKey,
  encryptWithMk,
  decryptWithMk,
  saveSecret,
  getSecret,
  deleteSecret,
};

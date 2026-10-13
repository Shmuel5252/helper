// AES-256-GCM for the OpenArt token set at rest. Key: OPENART_TOKEN_KEY, 32 random bytes in
// base64 (e.g. `node -e "console.log(crypto.randomBytes(32).toString('base64'))"`).
// Format: base64(iv[12] | ciphertext+tag). Pure Web Crypto, unit-tested.

async function importKey(keyB64: string): Promise<CryptoKey> {
  const raw = Buffer.from(keyB64, "base64");
  if (raw.length !== 32) throw new Error("OPENART_TOKEN_KEY must be 32 bytes, base64-encoded");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encrypt(plain: string, keyB64: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await importKey(keyB64), new TextEncoder().encode(plain));
  return Buffer.concat([iv, new Uint8Array(ct)]).toString("base64");
}

export async function decrypt(sealed: string, keyB64: string): Promise<string> {
  const buf = Buffer.from(sealed, "base64");
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: buf.subarray(0, 12) }, await importKey(keyB64), buf.subarray(12));
  return new TextDecoder().decode(pt);
}

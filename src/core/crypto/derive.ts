export async function deriveSubkey(
  keyMaterial: Uint8Array,
  info: string,
  length = 32,
): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    keyMaterial.slice().buffer as ArrayBuffer,
    "HKDF",
    false,
    ["deriveKey"],
  )
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(32), info: new TextEncoder().encode(info) },
    baseKey,
    { name: "AES-GCM", length: length * 8 },
    false,
    ["encrypt", "decrypt"],
  )
}

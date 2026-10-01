function fromBase64(value: string): Uint8Array {
  const binary = atob(value)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

function compareBytes(a: Uint8Array, b: Uint8Array): number {
  for (let index = 0; index < Math.min(a.length, b.length); index++) {
    if (a[index] !== b[index]) return a[index] - b[index]
  }
  return a.length - b.length
}

export async function computeSafetyNumber(
  myPublicKey: Uint8Array | string,
  theirPublicKey: Uint8Array | string,
): Promise<string> {
  const first = typeof myPublicKey === "string" ? fromBase64(myPublicKey) : myPublicKey
  const second = typeof theirPublicKey === "string" ? fromBase64(theirPublicKey) : theirPublicKey
  const [left, right] = compareBytes(first, second) <= 0
    ? [first, second]
    : [second, first]
  const combined = new Uint8Array(left.length + right.length)
  combined.set(left)
  combined.set(right, left.length)
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", combined))
  const digits = Array.from(digest, (byte) => String(byte).padStart(3, "0")).join("")
  return digits.slice(0, 16).replace(/(\d{4})(?=\d)/g, "$1 ").trim()
}

import { beforeEach, describe, expect, it, vi } from "vitest"

const idbStore = new Map<string, unknown>()
vi.mock("idb-keyval", () => ({
  get: async (key: string) => idbStore.get(key),
  set: async (key: string, value: unknown) => {
    idbStore.set(key, value)
  },
}))

import {
  authenticate,
  DEFAULT_KEYSTORE_CONFIG,
  generateTier0Key,
  getAuthenticationProof,
  getTier0Key,
  hasTier0Key,
  InvalidUnlockProofError,
  KeystoreLock,
  registerAuthenticator,
  unwrapWithTier0,
  wrapWithTier0,
} from "./index"
import { getCDK, persistCDK } from "./index"

beforeEach(() => {
  idbStore.clear()
  vi.restoreAllMocks()
})

describe("Tier-0 key storage", () => {
  it("stores a non-extractable key and wraps/unwraps plaintext", async () => {
    await generateTier0Key()
    expect(await hasTier0Key()).toBe(true)
    const key = await getTier0Key()
    expect(key.extractable).toBe(false)
    await expect(crypto.subtle.exportKey("raw", key)).rejects.toThrow()

    const plaintext = new TextEncoder().encode("tier zero secret")
    expect(await unwrapWithTier0(await wrapWithTier0(plaintext))).toEqual(plaintext)
  })

  it("persists CDK material but requires the authentication proof to read it", async () => {
    await generateTier0Key()
    const cdk = Uint8Array.from([1, 2, 3, 4])
    await persistCDK(cdk)
    await expect(getCDK()).rejects.toThrow("WebAuthn authentication is required")
  })
})

describe("WebAuthn gate", () => {
  beforeEach(() => {
    vi.stubGlobal("window", {
      PublicKeyCredential: {
        isUserVerifyingPlatformAuthenticatorAvailable: vi.fn().mockResolvedValue(true),
      },
    })
    vi.stubGlobal("navigator", {
      credentials: {
        create: vi.fn().mockResolvedValue({ rawId: Uint8Array.from([1, 2, 3]).buffer }),
        get: vi.fn().mockResolvedValue({ id: "credential" }),
      },
    })
  })

  it("registers and authenticates successfully", async () => {
    expect(await registerAuthenticator("user-1", "User")).toEqual(
      Uint8Array.from([1, 2, 3]),
    )
    expect(await authenticate()).toBe(true)
    expect(getAuthenticationProof()).toBeDefined()
  })

  it("surfaces cancellation and missing credential reasons", async () => {
    await expect(authenticate()).rejects.toMatchObject({
      reason: "no-credential",
    })
    idbStore.set("just-us:webauthn-credential-id", Uint8Array.from([1]))
    vi.mocked(navigator.credentials.get).mockRejectedValueOnce(
      new DOMException("cancelled", "NotAllowedError"),
    )
    await expect(authenticate()).rejects.toMatchObject({
      reason: "user-cancelled",
    })
  })

  // Real biometric ceremonies require Playwright's Chrome DevTools Protocol
  // virtual authenticator and belong in a later end-to-end test.
})

describe("KeystoreLock", () => {
  it("auto-locks, resets on activity, and rejects invalid proofs", async () => {
    vi.useFakeTimers()
    vi.stubGlobal("window", {
      PublicKeyCredential: {
        isUserVerifyingPlatformAuthenticatorAvailable: vi.fn().mockResolvedValue(true),
      },
    })
    vi.stubGlobal("navigator", {
      credentials: {
        create: vi.fn().mockResolvedValue({ rawId: Uint8Array.from([1, 2, 3]).buffer }),
        get: vi.fn().mockResolvedValue({ id: "credential" }),
      },
    })
    const listeners = new Map<string, () => void>()
    vi.stubGlobal("document", {
      visibilityState: "visible",
      addEventListener: (type: string, listener: () => void) => listeners.set(type, listener),
      removeEventListener: (type: string) => listeners.delete(type),
    })
    const lock = new KeystoreLock()
    const onLock = vi.fn()
    lock.startAutoLockTimer({ autoLockMinutes: 1 }, onLock)
    expect(() => lock.unlock(undefined)).toThrow(InvalidUnlockProofError)

    await registerAuthenticator("user-1", "User")
    await authenticate()
    lock.unlock(getAuthenticationProof())
    expect(lock.getState()).toBe("unlocked")
    vi.advanceTimersByTime(30_000)
    lock.recordActivity()
    vi.advanceTimersByTime(29_999)
    expect(lock.getState()).toBe("unlocked")
    vi.advanceTimersByTime(61_000)
    expect(lock.getState()).toBe("locked")
    expect(onLock).toHaveBeenCalledOnce()
    expect(listeners.has("visibilitychange")).toBe(true)
    lock.stopAutoLockTimer()
    vi.useRealTimers()
  })

  it("uses the five-minute default configuration", () => {
    expect(DEFAULT_KEYSTORE_CONFIG.autoLockMinutes).toBe(5)
  })
})

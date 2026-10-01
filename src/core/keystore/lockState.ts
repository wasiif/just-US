import type { KeystoreConfig, LockState } from "./types"
import {
  isValidAuthenticationProof,
  type AuthenticationProof,
} from "./webauthn"

export class InvalidUnlockProofError extends Error {
  constructor() {
    super("Unlock requires a successful WebAuthn authentication proof")
    this.name = "InvalidUnlockProofError"
  }
}

export class KeystoreLock {
  private state: LockState = "locked"
  private timer: ReturnType<typeof setTimeout> | undefined
  private cleanupVisibilityListener: (() => void) | undefined
  private onLockCallback: (() => void) | undefined
  private timeoutMs = 5 * 60 * 1000

  getState(): LockState {
    return this.state
  }

  startAutoLockTimer(config: KeystoreConfig, onLock: () => void): () => void {
    this.stopAutoLockTimer()
    this.timeoutMs = Math.max(0, config.autoLockMinutes) * 60 * 1000
    this.onLockCallback = onLock
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") this.scheduleLock()
    }
    document.addEventListener("visibilitychange", onVisibilityChange)
    this.cleanupVisibilityListener = () =>
      document.removeEventListener("visibilitychange", onVisibilityChange)
    this.scheduleLock()
    return () => this.stopAutoLockTimer()
  }

  recordActivity(): void {
    if (this.state === "unlocked") this.scheduleLock()
  }

  unlock(proof: AuthenticationProof | undefined): void {
    if (!isValidAuthenticationProof(proof)) throw new InvalidUnlockProofError()
    this.state = "unlocked"
    this.scheduleLock()
  }

  lock(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    const wasUnlocked = this.state === "unlocked"
    this.state = "locked"
    if (wasUnlocked) this.onLockCallback?.()
  }

  stopAutoLockTimer(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    this.cleanupVisibilityListener?.()
    this.cleanupVisibilityListener = undefined
    this.onLockCallback = undefined
  }

  private scheduleLock(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => this.lock(), this.timeoutMs)
  }
}

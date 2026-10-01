export type LockState = "locked" | "unlocked"

export interface KeystoreConfig {
  autoLockMinutes: number
}

export const DEFAULT_KEYSTORE_CONFIG: KeystoreConfig = {
  autoLockMinutes: 5,
}

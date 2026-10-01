export type { KeystoreConfig, LockState } from "./types"
export { DEFAULT_KEYSTORE_CONFIG } from "./types"
export {
  generateTier0Key,
  getTier0Key,
  hasTier0Key,
  unwrapWithTier0,
  wrapWithTier0,
  Tier0KeyNotInitializedError,
} from "./tierKeys"
export {
  authenticateAndGetCDK,
  getCDK,
  getStoredWrappedCDK,
  persistCDK,
  CDKAuthenticationRequiredError,
  CDKNotInitializedError,
} from "./cdk"
export {
  authenticate,
  getAuthenticationProof,
  hasAuthenticatorCredential,
  isValidAuthenticationProof,
  isWebAuthnAvailable,
  KeystoreError,
  registerAuthenticator,
} from "./webauthn"
export type {
  AuthenticationProof,
  KeystoreErrorReason,
} from "./webauthn"
export { InvalidUnlockProofError, KeystoreLock } from "./lockState"
export { getPersistedCoupleId, persistCoupleId } from "./session"

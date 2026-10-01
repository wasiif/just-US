import { get, set } from "idb-keyval"

const CREDENTIAL_ID_KEY = "just-us:webauthn-credential-id"
const RP_NAME = "just-US"
const encoder = new TextEncoder()
const bufferSource = (bytes: Uint8Array): ArrayBuffer =>
  bytes.slice().buffer as ArrayBuffer
const proofSecret = Symbol("webauthn-proof")
let latestProof: AuthenticationProof | undefined

export type KeystoreErrorReason =
  | "not-supported"
  | "no-credential"
  | "user-cancelled"
  | "unknown"

export class KeystoreError extends Error {
  readonly reason: KeystoreErrorReason

  constructor(reason: KeystoreErrorReason, message: string) {
    super(message)
    this.name = "KeystoreError"
    this.reason = reason
  }
}

export interface AuthenticationProof {
  readonly issuedAt: number
  readonly [proofSecret]: true
}

function errorReason(error: unknown): KeystoreErrorReason {
  if (error instanceof KeystoreError) return error.reason
  if (error instanceof DOMException) {
    if (error.name === "NotSupportedError") return "not-supported"
    if (error.name === "AbortError" || error.name === "NotAllowedError") {
      return "user-cancelled"
    }
  }
  return "unknown"
}

function asKeystoreError(error: unknown, operation: string): KeystoreError {
  const reason = errorReason(error)
  return error instanceof KeystoreError
    ? error
    : new KeystoreError(reason, `${operation} failed (${reason})`)
}

export async function isWebAuthnAvailable(): Promise<boolean> {
  try {
    const credential = globalThis.window?.PublicKeyCredential
    if (!credential?.isUserVerifyingPlatformAuthenticatorAvailable) return false
    return await credential.isUserVerifyingPlatformAuthenticatorAvailable()
  } catch {
    return false
  }
}

export async function registerAuthenticator(
  userId: string,
  userDisplayName: string,
): Promise<Uint8Array> {
  try {
    if (!(await isWebAuthnAvailable())) {
      throw new KeystoreError("not-supported", "WebAuthn platform authenticator is unavailable")
    }

    const credential = await navigator.credentials.create({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rp: { name: RP_NAME },
        user: {
          id: bufferSource(encoder.encode(userId)),
          name: userId,
          displayName: userDisplayName,
        },
        pubKeyCredParams: [{ type: "public-key", alg: -7 }],
        authenticatorSelection: {
          authenticatorAttachment: "platform",
          userVerification: "required",
        },
      },
    })
    if (!credential || !("rawId" in credential)) {
      throw new KeystoreError("unknown", "WebAuthn registration returned no credential")
    }

    const credentialId = new Uint8Array((credential as PublicKeyCredential).rawId)
    await set(CREDENTIAL_ID_KEY, credentialId)
    return credentialId
  } catch (error) {
    throw asKeystoreError(error, "WebAuthn registration")
  }
}

export async function hasAuthenticatorCredential(): Promise<boolean> {
  return (await get<Uint8Array | undefined>(CREDENTIAL_ID_KEY)) !== undefined
}

export async function authenticate(): Promise<boolean> {
  try {
    const credentialId = await get<Uint8Array | undefined>(CREDENTIAL_ID_KEY)
    if (!credentialId) {
      throw new KeystoreError("no-credential", "No WebAuthn credential is registered")
    }
    const credential = await navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        allowCredentials: [{ type: "public-key", id: bufferSource(credentialId) }],
        userVerification: "required",
      },
    })
    if (!credential) {
      throw new KeystoreError("unknown", "WebAuthn authentication returned no credential")
    }
    latestProof = { issuedAt: Date.now(), [proofSecret]: true }
    return true
  } catch (error) {
    latestProof = undefined
    throw asKeystoreError(error, "WebAuthn authentication")
  }
}

export function getAuthenticationProof(): AuthenticationProof | undefined {
  return latestProof
}

export function isValidAuthenticationProof(
  proof: AuthenticationProof | undefined,
): proof is AuthenticationProof {
  return proof?.[proofSecret] === true && proof === latestProof
}

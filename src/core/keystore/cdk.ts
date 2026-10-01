import { get, set } from "idb-keyval"
import type { Envelope } from "../crypto"
import { generateTier0Key, hasTier0Key, unwrapWithTier0, wrapWithTier0 } from "./tierKeys"
import {
  getAuthenticationProof,
  isValidAuthenticationProof,
  authenticate,
  type AuthenticationProof,
} from "./webauthn"

const CDK_KEY = "just-us:wrapped-cdk"

export class CDKNotInitializedError extends Error {
  constructor() {
    super("No wrapped couple decryption key is stored")
    this.name = "CDKNotInitializedError"
  }
}

export class CDKAuthenticationRequiredError extends Error {
  constructor() {
    super("WebAuthn authentication is required before reading the CDK")
    this.name = "CDKAuthenticationRequiredError"
  }
}

export async function persistCDK(cdk: Uint8Array): Promise<void> {
  if (!(await hasTier0Key())) await generateTier0Key()
  await set(CDK_KEY, await wrapWithTier0(cdk))
}

export async function getStoredWrappedCDK(): Promise<Envelope> {
  const envelope = await get<Envelope | undefined>(CDK_KEY)
  if (!envelope) throw new CDKNotInitializedError()
  return envelope
}

export async function getCDK(proof?: AuthenticationProof): Promise<Uint8Array> {
  const validProof = proof ?? getAuthenticationProof()
  if (!isValidAuthenticationProof(validProof)) {
    throw new CDKAuthenticationRequiredError()
  }
  return unwrapWithTier0(await getStoredWrappedCDK())
}

export async function authenticateAndGetCDK(): Promise<Uint8Array> {
  await authenticate()
  return getCDK()
}

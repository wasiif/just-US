export interface PairingPayload {
  coupleId: string
  publicKey: string
  signingPublicKey: string
  pairingNonce: string
}

export type PairingState =
  | "idle"
  | "generating"
  | "showing-code"
  | "scanning"
  | "exchanging"
  | "verifying-safety-number"
  | "complete"
  | "error"

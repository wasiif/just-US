export interface IdentityKeyPair {
  publicKey: Uint8Array
  privateKey: Uint8Array
}

export interface SigningKeyPair {
  publicKey: Uint8Array
  privateKey: Uint8Array
}

export interface Envelope {
  version: number
  keyVersion: number
  nonce: Uint8Array
  ciphertext: Uint8Array
}

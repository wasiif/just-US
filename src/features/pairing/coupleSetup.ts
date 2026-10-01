import { supabase as defaultSupabase } from "../../core/network/supabaseClient"
import type { SupabaseClient } from "@supabase/supabase-js"
import {
  generateRandomBytes,
  openSealed,
  sealToRecipient,
  type IdentityKeyPair,
} from "../../core/crypto"
import type { PairingPayload } from "./types"

export class PairingNetworkError extends Error {
  readonly operation: string

  constructor(operation: string, message: string) {
    super(`${operation} failed: ${message}`)
    this.name = "PairingNetworkError"
    this.operation = operation
  }
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

function bytesToBytea(bytes: Uint8Array): string {
  return `\\x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`
}

function throwIfError(operation: string, error: { message: string } | null): void {
  if (error) throw new PairingNetworkError(operation, error.message)
}

type PairingSupabaseClient = SupabaseClient

export async function createCouple(): Promise<{
  coupleId: string
  cdk: Uint8Array
  identityKeyPair: IdentityKeyPair
}> {
  return createCoupleWithClient(defaultSupabase)
}

export async function createCoupleWithClient(
  supabase: PairingSupabaseClient,
): Promise<{
  coupleId: string
  cdk: Uint8Array
  identityKeyPair: IdentityKeyPair
}> {
  const operation = "Create couple"
  const userId = await currentUserIdWithClient(supabase, operation)
  const coupleId = crypto.randomUUID()
  const { error: coupleError } = await supabase
    .from("couples")
    .insert({ id: coupleId, status: "active" })
  throwIfError(operation, coupleError)

  const { error: memberError } = await supabase.from("couple_members").insert({
    couple_id: coupleId,
    user_id: userId,
    slot: 1,
  })
  throwIfError("Add couple member", memberError)

  const { generateIdentityKeyPair } = await import("../../core/crypto")
  const identityKeyPair = await generateIdentityKeyPair()
  const cdk = generateRandomBytes(32)
  const wrappedCdk = await sealToRecipient(cdk, identityKeyPair.publicKey)
  const { error: keyError } = await supabase.from("couple_keys").insert({
    couple_id: coupleId,
    user_id: userId,
    key_version: 1,
    wrapped_cdk: bytesToBytea(wrappedCdk),
  })
  throwIfError("Store creator CDK", keyError)
  return { coupleId, cdk, identityKeyPair }
}

async function currentUserIdWithClient(
  client: PairingSupabaseClient,
  operation: string,
): Promise<string> {
  const { data, error } = await client.auth.getUser()
  if (error || !data.user) {
    throw new PairingNetworkError(operation, error?.message ?? "No authenticated user")
  }
  return data.user.id
}

export async function joinCouple(
  coupleId: string,
  pairingPayload: PairingPayload,
): Promise<void> {
  return joinCoupleWithClient(defaultSupabase, coupleId, pairingPayload)
}

export async function joinCoupleWithClient(
  client: PairingSupabaseClient,
  coupleId: string,
  pairingPayload: PairingPayload,
): Promise<void> {
  const userId = await currentUserIdWithClient(client, "Join couple")
  const { error } = await client.from("couple_members").insert({
    couple_id: coupleId,
    user_id: userId,
    slot: 2,
  })
  throwIfError("Join couple", error)
  void pairingPayload
}

export async function deliverCDK(
  coupleId: string,
  recipientPublicKey: string | Uint8Array,
  cdk: Uint8Array,
): Promise<void> {
  return deliverCDKWithClient(defaultSupabase, coupleId, recipientPublicKey, cdk)
}

export async function deliverCDKWithClient(
  client: PairingSupabaseClient,
  coupleId: string,
  recipientPublicKey: string | Uint8Array,
  cdk: Uint8Array,
): Promise<void> {
  await currentUserIdWithClient(client, "Deliver CDK")
  const publicKey = typeof recipientPublicKey === "string"
    ? base64ToBytes(recipientPublicKey)
    : recipientPublicKey
  const wrappedCdk = await sealToRecipient(cdk, publicKey)
  const { data: member, error: memberError } = await client
    .from("couple_members")
    .select("user_id")
    .eq("couple_id", coupleId)
    .eq("slot", 2)
    .single()
  throwIfError("Find recipient member", memberError)
  if (!member) throw new PairingNetworkError("Deliver CDK", "Recipient has not joined")
  const { error } = await client.from("couple_keys").insert({
    couple_id: coupleId,
    user_id: member.user_id,
    key_version: 1,
    wrapped_cdk: bytesToBytea(wrappedCdk),
  })
  throwIfError("Deliver CDK", error)
}

export async function fetchWrappedCDK(
  coupleId: string,
  recipientKeyPair: IdentityKeyPair,
): Promise<Uint8Array> {
  return fetchWrappedCDKWithClient(defaultSupabase, coupleId, recipientKeyPair)
}

export async function fetchWrappedCDKWithClient(
  client: PairingSupabaseClient,
  coupleId: string,
  recipientKeyPair: IdentityKeyPair,
): Promise<Uint8Array> {
  const operation = "Fetch wrapped CDK"
  const userId = await currentUserIdWithClient(client, operation)
  const { data: existing, error: existingError } = await client
    .from("couple_keys")
    .select("wrapped_cdk")
    .eq("couple_id", coupleId)
    .eq("user_id", userId)
    .maybeSingle()
  throwIfError(operation, existingError)
  if (typeof existing?.wrapped_cdk === "string") {
    const bytes = Uint8Array.from(
      existing.wrapped_cdk.replace(/^\\x/u, "").match(/../g) ?? [],
      (pair) => Number.parseInt(pair, 16),
    )
    try {
      return await openSealed(bytes, recipientKeyPair)
    } catch (error) {
      throw error
    }
  }
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      void client.removeChannel(channel)
      callback()
    }
      const unwrap = async (wrapped: string | Uint8Array) => {
      try {
        const bytes = typeof wrapped === "string"
            ? Uint8Array.from(
              wrapped.replace(/^\\x/u, "").match(/../g) ?? [],
              (pair) => Number.parseInt(pair, 16),
            )
            : wrapped
        const plaintext = await openSealed(bytes, recipientKeyPair)
        finish(() => resolve(plaintext))
      } catch (error) {
        finish(() => reject(error))
      }
    }
    const channel = client
      .channel(`couple-keys-${coupleId}-${userId}`)
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "couple_keys",
        filter: `couple_id=eq.${coupleId}`,
      }, (payload) => {
        const row = payload.new as { user_id?: string; wrapped_cdk?: string }
        if (row.user_id === userId && row.wrapped_cdk) void unwrap(row.wrapped_cdk)
      })
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          finish(() => reject(new PairingNetworkError(operation, status)))
        }
      })
  })
}

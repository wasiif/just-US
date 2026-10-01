import { beforeAll, describe, expect, it, vi } from "vitest"
import "fake-indexeddb/auto"
import { createClient } from "@supabase/supabase-js"
import { del } from "idb-keyval"
import sodium from "libsodium-wrappers-sumo"
import {
  createCoupleWithClient,
  deliverCDKWithClient,
  fetchWrappedCDKWithClient,
  joinCoupleWithClient,
} from "./coupleSetup"
import { generateIdentityKeyPair, generateRandomBytes } from "../../core/crypto"
import { deriveAndWrapCDK, uploadKeyBackup } from "./recoveryBackup"
import { restoreFromPhrase } from "./recoveryRestore"

beforeAll(async () => {
  await sodium.ready
  vi.stubGlobal("Worker", class {
    private listeners: Array<(event: MessageEvent) => void> = []

    addEventListener(type: string, listener: (event: MessageEvent) => void) {
      if (type === "message") this.listeners.push(listener)
    }

    postMessage(request: { id: number; method: string; args: unknown[] }) {
      let result: unknown
      if (request.method === "generateIdentityKeyPair") {
        result = sodium.crypto_box_keypair()
      } else if (request.method === "sealToRecipient") {
        result = sodium.crypto_box_seal(
          request.args[0] as Uint8Array,
          request.args[1] as Uint8Array,
        )
      } else if (request.method === "openSealed") {
        const pair = request.args[1] as { publicKey: Uint8Array; privateKey: Uint8Array }
        result = sodium.crypto_box_seal_open(
          request.args[0] as Uint8Array,
          pair.publicKey,
          pair.privateKey,
        )
      } else if (request.method === "deriveRecoveryKey") {
        result = sodium.crypto_pwhash(
          32,
          request.args[0] as string,
          sodium.crypto_generichash(16, "just-US recovery key", null),
          sodium.crypto_pwhash_OPSLIMIT_INTERACTIVE,
          sodium.crypto_pwhash_MEMLIMIT_INTERACTIVE,
          sodium.crypto_pwhash_ALG_ARGON2ID13,
        )
      } else {
        throw new Error(`Unsupported integration Worker method: ${request.method}`)
      }
      queueMicrotask(() => {
        for (const listener of this.listeners) {
          listener({ data: { id: request.id, result } } as MessageEvent)
        }
      })
    }
  })
})

/*
 * Requires a running Supabase stack, configured VITE_SUPABASE_URL and
 * VITE_SUPABASE_ANON_KEY, plus test-user credentials. Run explicitly with
 * RUN_SUPABASE_INTEGRATION=1; real auth/RLS/Reatime coverage is not a unit test.
 */
const runtimeEnv = typeof process === "undefined" ? {} : process.env
const integrationEnabled =
  runtimeEnv.RUN_SUPABASE_INTEGRATION === "1"
const url = runtimeEnv.SUPABASE_URL ?? import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
const serviceRoleKey = runtimeEnv.SUPABASE_SERVICE_ROLE_KEY
const testPassword = runtimeEnv.SUPABASE_TEST_PASSWORD ?? `Pairing-${crypto.randomUUID()}!`

function createAnonClient() {
  return createClient(url, anonKey)
}

async function signIn(client: ReturnType<typeof createAnonClient>, email: string) {
  const { data, error } = await client.auth.signInWithPassword({
    email,
    password: testPassword,
  })
  if (error || !data.session) {
    throw new Error(`Test sign-in failed for ${email}: ${error?.message ?? "no session"}`)
  }
  const { data: userData, error: userError } = await client.auth.getUser()
  if (userError || !userData.user) {
    throw new Error(`Test getUser failed for ${email}: ${userError?.message ?? "no user"}`)
  }
  return userData.user
}

async function createThrowawayUser(email: string) {
  if (!serviceRoleKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required")
  const admin = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: testPassword,
    email_confirm: true,
  })
  if (error || !data.user) throw error ?? new Error("Supabase did not return a test user")
  return data.user
}

function createAdminClient() {
  if (!serviceRoleKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required")
  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

describe.skipIf(!integrationEnabled)("pairing Supabase integration", () => {
  it("exchanges a CDK through Realtime and denies an unrelated member", async () => {
    const creatorEmail = `pairing-a-${crypto.randomUUID()}@example.test`
    const recipientEmail = `pairing-b-${crypto.randomUUID()}@example.test`
    await createThrowawayUser(creatorEmail)
    const creatorClient = createAnonClient()
    const recipientClient = createAnonClient()
    await signIn(creatorClient, creatorEmail)
    const creator = await createCoupleWithClient(creatorClient)
    const recipient = await generateIdentityKeyPair()
    const cdk = generateRandomBytes(32)
    await createThrowawayUser(recipientEmail)
    await signIn(recipientClient, recipientEmail)
    await joinCoupleWithClient(recipientClient, creator.coupleId, {
      coupleId: creator.coupleId,
      publicKey: btoa(String.fromCharCode(...recipient.publicKey)),
      signingPublicKey: btoa("signing-key"),
      pairingNonce: btoa("nonce"),
    })
    await deliverCDKWithClient(creatorClient, creator.coupleId, recipient.publicKey, cdk)
    await expect(fetchWrappedCDKWithClient(recipientClient, creator.coupleId, recipient)).resolves.toEqual(cdk)
    expect(cdk).toHaveLength(32)

    const outsiderEmail = `pairing-outsider-key-${crypto.randomUUID()}@example.test`
    const outsider = await createThrowawayUser(outsiderEmail)
    const { error: outsiderKeyError } = await creatorClient.from("couple_keys").insert({
      couple_id: creator.coupleId,
      user_id: outsider.id,
      key_version: 1,
      wrapped_cdk: "\\x00",
    })
    expect(outsiderKeyError?.code).toBe("42501")
  }, 30_000)

  it("rejects a third member at the database unique slot constraint", async () => {
    const creatorEmail = `pairing-constraint-a-${crypto.randomUUID()}@example.test`
    const thirdEmail = `pairing-constraint-third-${crypto.randomUUID()}@example.test`
    await createThrowawayUser(creatorEmail)
    const creatorClient = createAnonClient()
    await signIn(creatorClient, creatorEmail)
    const creator = await createCoupleWithClient(creatorClient)
    const third = await createThrowawayUser(thirdEmail)
    const admin = createAdminClient()
    const { error } = await admin.from("couple_members").insert({
      couple_id: creator.coupleId,
      user_id: third.id,
      slot: 1,
    })
    expect(error?.code).toBe("23505")
  })

  it("denies a third unrelated authenticated user access to couple_keys", async () => {
    if (!testPassword) throw new Error("SUPABASE_TEST_PASSWORD is required for integration tests")
    const third = createAnonClient()
    const email = `pairing-third-${crypto.randomUUID()}@example.test`
    await createThrowawayUser(email)
    await signIn(third, email)
    const { data, error } = await third
      .from("couple_keys")
      .select("id")
      .limit(1)
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it("allows a couple member to upload a recovery backup and denies outsiders", async () => {
    const creatorEmail = `recovery-a-${crypto.randomUUID()}@example.test`
    const outsiderEmail = `recovery-outsider-${crypto.randomUUID()}@example.test`
    await createThrowawayUser(creatorEmail)
    await createThrowawayUser(outsiderEmail)
    const creatorClient = createAnonClient()
    const outsiderClient = createAnonClient()
    await signIn(creatorClient, creatorEmail)
    const creator = await createCoupleWithClient(creatorClient)
    const wrapped = await deriveAndWrapCDK(
      "abandon ".repeat(23) + "ability",
      creator.cdk,
    )
    await uploadKeyBackup(creator.coupleId, wrapped, creatorClient)
    await signIn(outsiderClient, outsiderEmail)
    const { data, error } = await outsiderClient
      .from("key_backups")
      .select("couple_id")
      .eq("couple_id", creator.coupleId)
    expect(error).toBeNull()
    expect(data).toEqual([])
  }, 30_000)

  it("restores a lost device CDK from the recovery phrase", async () => {
    const email = `recovery-restore-${crypto.randomUUID()}@example.test`
    const user = await createThrowawayUser(email)
    const client = createAnonClient()
    await signIn(client, email)
    const creator = await createCoupleWithClient(client)
    const phrase = "abandon ".repeat(23) + "ability"
    await uploadKeyBackup(
      creator.coupleId,
      await deriveAndWrapCDK(phrase, creator.cdk),
      client,
    )
    await del("just-us:tier-0-key")
    await del("just-us:wrapped-cdk")
    vi.stubGlobal("window", {
      PublicKeyCredential: {
        isUserVerifyingPlatformAuthenticatorAvailable: vi.fn().mockResolvedValue(true),
      },
    })
    vi.stubGlobal("navigator", {
      credentials: {
        create: vi.fn().mockResolvedValue({
          rawId: Uint8Array.from([9, 8, 7]).buffer,
        }),
      },
    })
    await expect(
      restoreFromPhrase(creator.coupleId, phrase, user.id, "Recovery user", client),
    ).resolves.toEqual(creator.cdk)
  }, 30_000)
})

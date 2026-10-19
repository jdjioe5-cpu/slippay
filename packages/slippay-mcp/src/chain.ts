// SlipPay MCP chain engine — non-custodial, client-side. The agent holds its own
// key (SLIPPAY_SIGNER_SECRET); this builds, signs, and submits Soroban/Stellar
// transactions straight to an RPC. No SlipPay backend is ever in the path — same
// trust posture as slippay_verify. Mirrors the proven mainnet/testnet scripts
// (e2e-subscription-charge / autocharge / upload-deploy).

import {
  rpc as SorobanRpc, Keypair, Networks, TransactionBuilder, Contract,
  Address, Asset, nativeToScVal, xdr, BASE_FEE, Horizon,
} from "@stellar/stellar-sdk";
import { randomBytes } from "node:crypto";

const NET = (process.env.SLIPPAY_NETWORK ?? "testnet").toLowerCase();
export const IS_PUBLIC = NET === "public" || NET === "mainnet";
export const PASSPHRASE = IS_PUBLIC ? Networks.PUBLIC : Networks.TESTNET;
export const RPC_URL = process.env.SLIPPAY_RPC_URL ?? (IS_PUBLIC ? "https://mainnet.sorobanrpc.com" : "https://soroban-testnet.stellar.org");
export const HORIZON_URL = process.env.SLIPPAY_HORIZON_URL ?? (IS_PUBLIC ? "https://horizon.stellar.org" : "https://horizon-testnet.stellar.org");
export const USDC_ISSUER = process.env.SLIPPAY_USDC_ISSUER ?? (IS_PUBLIC
  ? "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"
  : "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5");

export function explorerTx(hash: string): string {
  return `https://stellar.expert/explorer/${IS_PUBLIC ? "public" : "testnet"}/tx/${hash}`;
}

export function signer(): Keypair {
  const s = process.env.SLIPPAY_SIGNER_SECRET;
  if (!s) throw new Error("SLIPPAY_SIGNER_SECRET not set — the agent's wallet secret is required to sign. (Non-custodial: it never leaves this process.)");
  return Keypair.fromSecret(s);
}
export function subContract(): string {
  const c = process.env.SLIPPAY_CONTRACT;
  if (!c) throw new Error("SLIPPAY_CONTRACT not set — the SlipPay subscription contract id (C…).");
  return c;
}

// ── scval helpers ──
export const scAddr = (g: string) => new Address(g).toScVal();
export const scI128 = (n: string | number | bigint) => nativeToScVal(BigInt(n), { type: "i128" });
export const scU64 = (n: string | number) => nativeToScVal(BigInt(n), { type: "u64" });
export const scU32 = (n: number) => nativeToScVal(n, { type: "u32" });
export const scBytes = (hex: string) => xdr.ScVal.scvBytes(Buffer.from(hex.replace(/^0x/, ""), "hex"));
export function usdcSacId(): string {
  return new Asset("USDC", USDC_ISSUER).contractId(PASSPHRASE);
}
export function randomNonceHex(): string {
  return randomBytes(32).toString("hex");
}

export interface TxResult { hash: string; status: string; explorer: string; ret?: unknown }

// ── Client injection hooks for unit testing with mocked RPC ──
export type RpcClient = Pick<SorobanRpc.Server, "getAccount" | "simulateTransaction" | "sendTransaction" | "getTransaction">;
let rpcClientOverride: RpcClient | null = null;
export function setRpcClient(client: RpcClient | null) {
  rpcClientOverride = client;
}
export function getRpcClient(): SorobanRpc.Server | RpcClient {
  return rpcClientOverride ?? new SorobanRpc.Server(RPC_URL);
}

export type HorizonClient = Pick<Horizon.Server, "transactions">;
let horizonClientOverride: HorizonClient | null = null;
export function setHorizonClient(client: HorizonClient | null) {
  horizonClientOverride = client;
}
export function getHorizonClient(): Horizon.Server | HorizonClient {
  return horizonClientOverride ?? new Horizon.Server(HORIZON_URL);
}

export async function submit(contractId: string, fn: string, args: xdr.ScVal[]): Promise<TxResult> {
  const kp = signer();
  const srv = getRpcClient();
  const c = new Contract(contractId);
  const src = await srv.getAccount(kp.publicKey());
  const tx = new TransactionBuilder(src, { fee: String(Number(BASE_FEE) * 1000), networkPassphrase: PASSPHRASE })
    .addOperation(c.call(fn, ...args)).setTimeout(60).build();
  const sim = await srv.simulateTransaction(tx);
  if (SorobanRpc.Api.isSimulationError(sim)) throw new Error(`simulation failed (${fn}): ${sim.error}`);
  const assembled = SorobanRpc.assembleTransaction(tx, sim).build();
  assembled.sign(kp);
  const sent = await srv.sendTransaction(assembled);
  if (sent.status === "ERROR") throw new Error(`send error (${fn}): ${JSON.stringify(sent.errorResult ?? sent)}`);
  let res = await srv.getTransaction(sent.hash);
  for (let i = 0; i < 45 && res.status === "NOT_FOUND"; i++) { await new Promise((r) => setTimeout(r, 1000)); res = await srv.getTransaction(sent.hash); }
  return { hash: sent.hash, status: res.status, explorer: explorerTx(sent.hash) };
}

// ── public ops (each = one signed on-chain action) ──

export function whoami(): string { return signer().publicKey(); }

/** Direct asset payment (SAC transfer) from the agent wallet to a recipient. */
export async function pay(recipient: string, amount: string, assetCode = "USDC"): Promise<TxResult> {
  const num = Number(amount);
  if (isNaN(num) || num <= 0) {
    throw new Error(`Invalid amount: "${amount}". Amount must be a positive decimal number.`);
  }
  const issuer = assetCode === "USDC" ? USDC_ISSUER : (process.env.SLIPPAY_ASSET_ISSUER ?? USDC_ISSUER);
  const sacId = new Asset(assetCode, issuer).contractId(PASSPHRASE);
  const stroops = BigInt(Math.round(num * 1e7));
  return submit(sacId, "transfer", [scAddr(whoami()), scAddr(recipient), scI128(stroops)]);
}

/** Create an on-chain recurring subscription (agent = buyer). Returns the sub id (nonce hex). */
export async function subscribe(merchant: string, amountUsdc: string, periodSeconds: number, maxPeriods = 0, expiresAt = 0): Promise<TxResult & { subscription_id: string }> {
  const num = Number(amountUsdc);
  if (isNaN(num) || num <= 0) {
    throw new Error(`Invalid amount: "${amountUsdc}". Amount must be a positive decimal number.`);
  }
  if (!Number.isInteger(periodSeconds) || periodSeconds < 86400) {
    throw new Error(`Invalid period_seconds: ${periodSeconds}. Contract requires integer period >= 86400 (1 day).`);
  }
  if (!Number.isInteger(maxPeriods) || maxPeriods < 0) {
    throw new Error(`Invalid max_periods: ${maxPeriods}. Must be an integer >= 0.`);
  }
  if (!Number.isInteger(expiresAt) || expiresAt < 0) {
    throw new Error(`Invalid expires_at: ${expiresAt}. Must be an integer >= 0.`);
  }
  const nonce = randomNonceHex();
  const stroops = BigInt(Math.round(num * 1e7));
  const r = await submit(subContract(), "create", [
    scAddr(whoami()), scAddr(merchant), scAddr(usdcSacId()),
    scI128(stroops), scU64(periodSeconds), scU32(maxPeriods), scU64(expiresAt), scBytes(nonce),
  ]);
  return { ...r, subscription_id: nonce };
}

/** Approve the subscription contract as a SEP-41 spender — the ONE signature that turns on autonomous debit. */
export async function approve(amountUsdc: string, expirationLedger: number): Promise<TxResult> {
  const num = Number(amountUsdc);
  if (isNaN(num) || num <= 0) {
    throw new Error(`Invalid amount: "${amountUsdc}". Amount must be a positive decimal number.`);
  }
  if (!Number.isInteger(expirationLedger) || expirationLedger <= 0) {
    throw new Error(`Invalid expiration_ledger: ${expirationLedger}. Must be a positive integer ledger sequence.`);
  }
  const stroops = BigInt(Math.round(num * 1e7));
  return submit(usdcSacId(), "approve", [scAddr(whoami()), scAddr(subContract()), scI128(stroops), scU32(expirationLedger)]);
}

/** Trigger an autonomous charge (no buyer signature; uses the standing allowance). */
export async function autocharge(subscriptionId: string): Promise<TxResult> {
  if (!subscriptionId || !/^[0-9a-fA-F]{64}$/.test(subscriptionId.replace(/^0x/, ""))) {
    throw new Error(`Invalid subscription_id: "${subscriptionId}". Must be 32-byte hex string.`);
  }
  return submit(subContract(), "autocharge", [scBytes(subscriptionId)]);
}

/** Trigger an attested autonomous charge — settles only with a valid, fresh, single-use integrity attestation. */
export async function autochargeAttested(subscriptionId: string, notAfter: number, signatureHex: string): Promise<TxResult> {
  if (!subscriptionId || !/^[0-9a-fA-F]{64}$/.test(subscriptionId.replace(/^0x/, ""))) {
    throw new Error(`Invalid subscription_id: "${subscriptionId}". Must be 32-byte hex string.`);
  }
  if (!Number.isInteger(notAfter) || notAfter <= 0) {
    throw new Error(`Invalid not_after: ${notAfter}. Must be a positive unix timestamp.`);
  }
  if (!signatureHex || !/^[0-9a-fA-F]{128}$/.test(signatureHex.replace(/^0x/, ""))) {
    throw new Error(`Invalid signature: "${signatureHex}". Must be 64-byte (128 hex chars) ed25519 signature.`);
  }
  return submit(subContract(), "autocharge_attested", [scBytes(subscriptionId), scU64(notAfter), scBytes(signatureHex)]);
}

/** Arm the integrity gate: bind an ed25519 attester pubkey to the subscription. */
export async function armGate(subscriptionId: string, attesterPubkeyHex: string): Promise<TxResult> {
  if (!subscriptionId || !/^[0-9a-fA-F]{64}$/.test(subscriptionId.replace(/^0x/, ""))) {
    throw new Error(`Invalid subscription_id: "${subscriptionId}". Must be 32-byte hex string.`);
  }
  if (!attesterPubkeyHex || !/^[0-9a-fA-F]{64}$/.test(attesterPubkeyHex.replace(/^0x/, ""))) {
    throw new Error(`Invalid attester_pubkey: "${attesterPubkeyHex}". Must be 32-byte (64 hex chars) ed25519 public key.`);
  }
  return submit(subContract(), "set_attester", [scBytes(subscriptionId), scBytes(attesterPubkeyHex)]);
}

/** Read a transaction's settlement status from Horizon (no backend). */
export async function txStatus(hash: string): Promise<unknown> {
  if (!hash || !/^[0-9a-fA-F]{64}$/.test(hash)) {
    throw new Error(`Invalid transaction hash: "${hash}". Must be 64 hex characters.`);
  }
  const srv = getHorizonClient();
  try {
    const tx = await srv.transactions().transaction(hash).call();
    return { found: true, successful: tx.successful, ledger: tx.ledger_attr, created_at: tx.created_at, explorer: explorerTx(hash) };
  } catch (e) {
    return { found: false, detail: (e as Error).message, explorer: explorerTx(hash) };
  }
}

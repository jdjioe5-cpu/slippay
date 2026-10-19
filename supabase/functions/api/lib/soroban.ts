// Build unsigned Soroban transactions for slippay-subscription contract
// invocations. The api never holds the buyer's secret — it returns the
// unsigned XDR; the buyer signs externally (Freighter, Lab, or our SDK)
// and submits via stellar-sdk SorobanRpc.

import {
  Address, BASE_FEE, Contract, Networks, Operation,
  rpc as SorobanRpc, TransactionBuilder, nativeToScVal, xdr,
} from "npm:@stellar/stellar-sdk@13";
import { hexToBuf } from "@slippay/shared";

export interface SorobanConfig {
  network: "testnet" | "mainnet";
  rpcUrl: string;
  passphrase: string;
}

export const DEFAULT_SOROBAN_RPC: Record<"testnet" | "mainnet", string> = {
  testnet: "https://soroban-testnet.stellar.org",
  mainnet: "https://soroban-mainnet.stellar.org",
};

/**
 * Resolves the Soroban RPC endpoint from configuration, with environment overrides
 * taking precedence over SDF public endpoints.
 */
export function getSorobanRpcUrl(network: "testnet" | "mainnet"): string {
  const globalRpc = Deno.env.get("SOROBAN_RPC")?.trim();
  if (globalRpc) return globalRpc;

  if (network === "mainnet") {
    return Deno.env.get("SOROBAN_RPC_MAINNET")?.trim() || DEFAULT_SOROBAN_RPC.mainnet;
  }
  return Deno.env.get("SOROBAN_RPC_TESTNET")?.trim() || DEFAULT_SOROBAN_RPC.testnet;
}

export function getSorobanConfig(network: "testnet" | "mainnet"): SorobanConfig {
  return {
    network,
    rpcUrl: getSorobanRpcUrl(network),
    passphrase: network === "mainnet" ? Networks.PUBLIC : Networks.TESTNET,
  };
}

export const SOROBAN_NET: Record<"testnet" | "mainnet", SorobanConfig> = {
  get testnet(): SorobanConfig {
    return getSorobanConfig("testnet");
  },
  get mainnet(): SorobanConfig {
    return getSorobanConfig("mainnet");
  },
};

export class SorobanRpcError extends Error {
  readonly isTransport: boolean;
  readonly rpcUrl: string;

  constructor(message: string, rpcUrl: string, isTransport = false) {
    super(message);
    this.name = "SorobanRpcError";
    this.rpcUrl = rpcUrl;
    this.isTransport = isTransport;
  }
}

export interface BuildChargeTxArgs {
  contractId: string;
  subscriptionNonce: string;  // 32-byte hex
  buyerAddress: string;
  network: "testnet" | "mainnet";
  fee?: string;
  timeoutSeconds?: number;
  rpcUrlOverride?: string;
}

export interface BuildChargeTxResult {
  unsigned_xdr: string;
  contract_id: string;
  subscription_nonce: string;
  buyer_address: string;
  network: "testnet" | "mainnet";
  passphrase: string;
  rpc_url: string;
  next_due_at?: number;        // from simulation, if available
  simulation_ok: boolean;
  simulation_error?: string;
}

/**
 * Build an unsigned transaction that invokes contract.charge(id).
 * Returns the XDR for the buyer to sign externally and submit.
 *
 * The buyer's account must:
 *   - exist on Stellar with at least 1 XLM reserve (free via friendbot on testnet)
 *   - hold sufficient amount of the SAC token to cover the charge
 *   - sign the returned XDR (their Stellar wallet adds the auth signature)
 */
export async function buildChargeTransaction(
  args: BuildChargeTxArgs,
): Promise<BuildChargeTxResult> {
  const cfg = getSorobanConfig(args.network);
  const rpcUrl = args.rpcUrlOverride ?? cfg.rpcUrl;
  const rpc = new SorobanRpc.Server(rpcUrl, { allowHttp: rpcUrl.startsWith("http://") });

  // 1. Load buyer account (need its sequence number)
  let account;
  try {
    account = await rpc.getAccount(args.buyerAddress);
  } catch (e: unknown) {
    const err = e as { message?: string; code?: string; isAxiosError?: boolean; response?: { status?: number } };
    const errMsg = String(err?.message ?? e);
    const code = String(err?.code ?? "");
    const status = err?.response?.status;

    // Distinguish transport/network failure from logical 404 (buyer account not found)
    if (
      err?.isAxiosError && status === 404
    ) {
      throw new Error(`buyer account not found on ${args.network}: ${args.buyerAddress}`);
    }

    if (
      err?.isAxiosError ||
      code === "ECONNREFUSED" ||
      code === "ETIMEDOUT" ||
      code === "ENOTFOUND" ||
      code === "ERR_NETWORK" ||
      errMsg.includes("ECONNREFUSED") ||
      errMsg.includes("ETIMEDOUT") ||
      errMsg.includes("ENOTFOUND") ||
      errMsg.includes("fetch failed") ||
      errMsg.includes("network error") ||
      (status && status >= 500)
    ) {
      throw new SorobanRpcError(`Failed to reach Soroban RPC at ${rpcUrl}: ${errMsg}`, rpcUrl, true);
    }
    throw new Error(`buyer account not found on ${args.network}: ${args.buyerAddress}`);
  }

  // 2. Build the contract.charge(id) operation
  const contract = new Contract(args.contractId);
  const nonceBytes = hexToBuf(args.subscriptionNonce);
  if (nonceBytes.length !== 32) {
    throw new Error(`subscription_nonce must be 32 bytes (64 hex chars); got ${nonceBytes.length}`);
  }
  const op = contract.call("charge", nativeToScVal(nonceBytes, { type: "bytes" }));

  // 3. Assemble transaction
  const tx = new TransactionBuilder(account, {
    fee: args.fee ?? BASE_FEE,
    networkPassphrase: cfg.passphrase,
  })
    .addOperation(op)
    .setTimeout(args.timeoutSeconds ?? 60)
    .build();

  // 4. Simulate to discover auth requirements + resource fees + return value
  let sim;
  try {
    sim = await rpc.simulateTransaction(tx);
  } catch (e: unknown) {
    const errMsg = String((e as Error)?.message ?? e);
    throw new SorobanRpcError(`Failed to reach Soroban RPC for simulation at ${rpcUrl}: ${errMsg}`, rpcUrl, true);
  }

  if (SorobanRpc.Api.isSimulationError(sim)) {
    return {
      unsigned_xdr: tx.toXDR(),
      contract_id: args.contractId,
      subscription_nonce: args.subscriptionNonce,
      buyer_address: args.buyerAddress,
      network: args.network,
      passphrase: cfg.passphrase,
      rpc_url: rpcUrl,
      simulation_ok: false,
      simulation_error: sim.error,
    };
  }

  // 5. Assemble (adds resource footprint + Soroban fees)
  const assembled = SorobanRpc.assembleTransaction(tx, sim).build();

  // Pull the simulated return value (next_due_at) if present
  let nextDueAt: number | undefined;
  if (sim.result?.retval) {
    try {
      const ret = sim.result.retval;
      // charge() returns u64 = next_due_at
      const u64 = ret.u64();
      nextDueAt = Number(u64.toString());
    } catch {
      // ignore — return value extraction is best-effort
    }
  }

  return {
    unsigned_xdr: assembled.toXDR(),
    contract_id: args.contractId,
    subscription_nonce: args.subscriptionNonce,
    buyer_address: args.buyerAddress,
    network: args.network,
    passphrase: cfg.passphrase,
    rpc_url: rpcUrl,
    next_due_at: nextDueAt,
    simulation_ok: true,
  };
}

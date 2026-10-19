import { describe, it, expect, vi } from "vitest";
import { Networks } from "@stellar/stellar-sdk";
import {
  resolveAnchorConfig,
  validateNetworkConsistency,
  STELLAR_NETWORK,
  NETWORK_PASSPHRASE,
  HORIZON_URL,
  HORIZON_TESTNET,
  ANCHOR_HOME,
  sep10Authenticate,
} from "./anchor";

describe("anchor network declaration and configuration", () => {
  it("defaults to TESTNET with consistent passphrase and Horizon URL", () => {
    const config = resolveAnchorConfig({});
    expect(config.network).toBe("TESTNET");
    expect(config.networkPassphrase).toBe(Networks.TESTNET);
    expect(config.horizonUrl).toBe("https://horizon-testnet.stellar.org");
    expect(config.anchorHome).toBe("https://testanchor.stellar.org");
    expect(config.isTestnet).toBe(true);
  });

  it("resolves PUBLIC configuration when VITE_STELLAR_NETWORK is set to PUBLIC", () => {
    const config = resolveAnchorConfig({
      VITE_STELLAR_NETWORK: "PUBLIC",
      VITE_ANCHOR_HOME: "https://anchor.partner.org",
      VITE_ANCHOR_ASSET_CODE: "USDC",
    });
    expect(config.network).toBe("PUBLIC");
    expect(config.networkPassphrase).toBe(Networks.PUBLIC);
    expect(config.horizonUrl).toBe("https://horizon.stellar.org");
    expect(config.anchorHome).toBe("https://anchor.partner.org");
    expect(config.isTestnet).toBe(false);
  });

  it("fails fast if PUBLIC network is paired with testanchor.stellar.org", () => {
    expect(() => {
      resolveAnchorConfig({
        VITE_STELLAR_NETWORK: "PUBLIC",
        VITE_ANCHOR_HOME: "https://testanchor.stellar.org",
      });
    }).toThrow(/anchor\.ts: network is configured as "PUBLIC", but ANCHOR_HOME is pointing to testanchor/);
  });

  it("validateNetworkConsistency validates without error for matching networks", () => {
    expect(() => {
      validateNetworkConsistency("https://testanchor.stellar.org", "TESTNET");
    }).not.toThrow();

    expect(() => {
      validateNetworkConsistency("https://anchor.moneygram.com", "PUBLIC");
    }).not.toThrow();
  });

  it("validateNetworkConsistency rejects testanchor under PUBLIC network with explicit message", () => {
    expect(() => {
      validateNetworkConsistency("https://testanchor.stellar.org", "PUBLIC");
    }).toThrow(/Production requires a mainnet anchor endpoint/);
  });

  it("exports matching module-level network constants", () => {
    expect(HORIZON_URL).toBe(HORIZON_TESTNET);
    expect(ANCHOR_HOME).toBeDefined();
    expect(NETWORK_PASSPHRASE).toBe(
      STELLAR_NETWORK === "PUBLIC" ? Networks.PUBLIC : Networks.TESTNET
    );
  });

  it("sep10Authenticate reports clear network mismatch if challenge passphrase differs", async () => {
    const fakeBuyer = {
      publicKey: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
      secretKey: "SBXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
    };

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        transaction: "AAAA...",
        network_passphrase: "Unexpected Other SDF Network ; 2026",
      }),
    });
    vi.stubGlobal("fetch", mockFetch);

    await expect(sep10Authenticate(fakeBuyer)).rejects.toThrow(
      /network mismatch: anchor declared network passphrase/
    );

    vi.unstubAllGlobals();
  });
});

import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { verifyDatabaseSchema } from "../lib/supabase.ts";
import type { SupabaseClient } from "supabase";

Deno.test("docker-compose.yml default schema matches supabase/config.toml exposed schemas", async () => {
  const composePath = new URL("../../../../docker-compose.yml", import.meta.url);
  const composeContent = await Deno.readTextFile(composePath);

  // Extract all ${SLIPPAY_DB_SCHEMA:-<default>} occurrences
  const matches = [...composeContent.matchAll(/\$\{SLIPPAY_DB_SCHEMA:-([^}]+)\}/g)];
  assert(matches.length >= 2, "Expected at least 2 SLIPPAY_DB_SCHEMA declarations in docker-compose.yml");

  for (const match of matches) {
    const defaultValue = match[1].trim();
    assertEquals(defaultValue, "public", `docker-compose.yml default schema must be "public", got "${defaultValue}"`);
  }

  // Read supabase/config.toml
  const configPath = new URL("../../../config.toml", import.meta.url);
  const configContent = await Deno.readTextFile(configPath);
  const schemaMatch = configContent.match(/schemas\s*=\s*\[([^\]]+)\]/);
  assert(schemaMatch, "schemas array not found in supabase/config.toml");

  const exposedSchemas = schemaMatch[1]
    .split(",")
    .map((s) => s.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);

  assert(
    exposedSchemas.includes("public"),
    `supabase/config.toml must expose "public" schema, got: ${JSON.stringify(exposedSchemas)}`,
  );

  for (const match of matches) {
    const defaultValue = match[1].trim();
    assert(
      exposedSchemas.includes(defaultValue),
      `docker-compose.yml default schema "${defaultValue}" is not exposed in supabase/config.toml (${JSON.stringify(exposedSchemas)})`,
    );
  }
});

Deno.test(".env.docker.example configures SLIPPAY_DB_SCHEMA=public", async () => {
  const envPath = new URL("../../../../.env.docker.example", import.meta.url);
  const envContent = await Deno.readTextFile(envPath);
  const match = envContent.match(/^SLIPPAY_DB_SCHEMA\s*=\s*(.*)$/m);
  assert(match, "SLIPPAY_DB_SCHEMA not found in .env.docker.example");
  assertEquals(match[1].trim(), "public");
});

Deno.test("verifyDatabaseSchema returns ok: true when query succeeds", async () => {
  const mockClient = {
    from: (_table: string) => ({
      select: (_cols: string) => ({
        limit: (_n: number) => Promise.resolve({ data: [{ id: "123" }], error: null }),
      }),
    }),
  } as unknown as SupabaseClient;

  const result = await verifyDatabaseSchema(mockClient, "public");
  assertEquals(result.ok, true);
  assertEquals(result.expectedSchema, "public");
});

Deno.test("verifyDatabaseSchema reports actionable error with configured and expected schema on failure", async () => {
  const mockClient = {
    from: (_table: string) => ({
      select: (_cols: string) => ({
        limit: (_n: number) =>
          Promise.resolve({
            data: null,
            error: {
              message: "The schema must be one of the following: public, graphql_public",
              code: "PGRST106",
            },
          }),
      }),
    }),
  } as unknown as SupabaseClient;

  const result = await verifyDatabaseSchema(mockClient, "public");
  assertEquals(result.ok, false);
  assert(result.error !== undefined);
  assert(result.error!.includes("public"));
  assert(result.error!.includes(result.configuredSchema));
  assert(result.error!.includes("PGRST106"));
});

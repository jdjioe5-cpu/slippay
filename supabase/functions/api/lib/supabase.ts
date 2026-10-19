import { createClient, SupabaseClient } from "supabase";

const SCHEMA = Deno.env.get("SLIPPAY_DB_SCHEMA") ?? "public";

export function userClient(req: Request): SupabaseClient {
  const auth = req.headers.get("authorization") ?? "";
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    {
      global: { headers: { Authorization: auth } },
      auth: { persistSession: false },
      db: { schema: SCHEMA },
    },
  ) as unknown as SupabaseClient;
}

export function serviceClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    {
      auth: { persistSession: false },
      db: { schema: SCHEMA },
    },
  ) as unknown as SupabaseClient;
}

export const CONFIGURED_SCHEMA = SCHEMA;
export const EXPECTED_SCHEMA = "public";

export interface SchemaVerificationResult {
  ok: boolean;
  configuredSchema: string;
  expectedSchema: string;
  error?: string;
}

export async function verifyDatabaseSchema(
  client?: SupabaseClient,
  expectedSchema = EXPECTED_SCHEMA,
): Promise<SchemaVerificationResult> {
  const configuredSchema = Deno.env.get("SLIPPAY_DB_SCHEMA") ?? "public";
  const supabase = client ?? serviceClient();

  try {
    const { error } = await supabase.from("merchants").select("id").limit(1);
    if (error) {
      const msg = `Database schema verification failed! Configured schema "${configuredSchema}" does not match expected "${expectedSchema}" or table "merchants" is missing/not exposed. Details: ${error.message}${error.code ? ` (code: ${error.code})` : ""}`;
      console.error(`[FATAL] ${msg}`);
      return {
        ok: false,
        configuredSchema,
        expectedSchema,
        error: msg,
      };
    }
    return {
      ok: true,
      configuredSchema,
      expectedSchema,
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const msg = `Database schema verification error! Configured schema "${configuredSchema}", expected "${expectedSchema}". Error: ${errorMsg}`;
    console.error(`[FATAL] ${msg}`);
    return {
      ok: false,
      configuredSchema,
      expectedSchema,
      error: msg,
    };
  }
}


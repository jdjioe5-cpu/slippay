// SPDX-License-Identifier: MIT
//
// Tests for database error mapping and 500 internal_error classification (Issue #501).

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { mapDbError } from "../lib/db-error.ts";

Deno.test("mapDbError: handles null or undefined error as 500 internal_error", () => {
  assertEquals(mapDbError(null), { code: "internal_error", status: 500 });
  assertEquals(mapDbError(undefined), { code: "internal_error", status: 500 });
});

Deno.test("mapDbError: maps recognized Postgres / PostgREST error codes correctly", () => {
  assertEquals(mapDbError({ code: "23505" }), { code: "constraint_violation", status: 409 });
  assertEquals(mapDbError({ code: "23503" }), { code: "reference_invalid", status: 400 });
  assertEquals(mapDbError({ code: "23502" }), { code: "value_required", status: 400 });
  assertEquals(mapDbError({ code: "23514" }), { code: "value_invalid", status: 400 });
  assertEquals(mapDbError({ code: "22001" }), { code: "value_too_long", status: 400 });
  assertEquals(mapDbError({ code: "22003" }), { code: "value_out_of_range", status: 400 });
  assertEquals(mapDbError({ code: "22P02" }), { code: "value_invalid", status: 400 });
  assertEquals(mapDbError({ code: "42501" }), { code: "forbidden", status: 403 });
  assertEquals(mapDbError({ code: "40001" }), { code: "conflict_retry", status: 409 });
  assertEquals(mapDbError({ code: "PGRST116" }), { code: "not_found", status: 404 });
});

Deno.test("mapDbError: sniffs nested messages when code is absent", () => {
  assertEquals(
    mapDbError({ message: "duplicate key value violates unique constraint" }),
    { code: "constraint_violation", status: 409 }
  );
  assertEquals(
    mapDbError({ message: "violates check constraint 'orders_amount_positive'" }),
    { code: "value_invalid", status: 400 }
  );
  assertEquals(
    mapDbError({ message: "violates foreign key constraint 'orders_merchant_id_fkey'" }),
    { code: "reference_invalid", status: 400 }
  );
});

Deno.test("mapDbError: classifies unmapped database faults as 500 internal_error", () => {
  // Capture console.error output to verify error code logging
  const logged: string[] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => {
    logged.push(args.map(String).join(" "));
  };

  try {
    // 57P01: admin_shutdown / terminating connection
    const res1 = mapDbError({ code: "57P01", message: "server terminated abnormally" });
    assertEquals(res1, { code: "internal_error", status: 500 });
    assertEquals(logged.some((l) => l.includes("57P01")), true);

    // 08006: connection_failure
    const res2 = mapDbError({ code: "08006", message: "connection refused" });
    assertEquals(res2, { code: "internal_error", status: 500 });
    assertEquals(logged.some((l) => l.includes("08006")), true);

    // Unrecognized string with no code
    const res3 = mapDbError({ message: "unexpected driver crash" });
    assertEquals(res3, { code: "internal_error", status: 500 });
    assertEquals(logged.some((l) => l.includes("unknown")), true);
  } finally {
    console.error = originalError;
  }
});

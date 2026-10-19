import { assertEquals, assertNotEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { Hono } from "hono";
import fourpRoute from "../routes/fourp.ts";
import { redactSensitiveQueryParams, timingSafeEqual } from "../lib/security.ts";

function createFourPApp() {
  const app = new Hono();
  app.route("/v1/4p", fourpRoute);
  return app;
}

Deno.test("POST /v1/4p/webhook rejects query string token (?token=...) with 400 missing_token", async () => {
  const prevApiKey = Deno.env.get("FOURP_API_KEY");
  Deno.env.set("FOURP_API_KEY", "test_fourp_api_key");

  try {
    const app = createFourPApp();
    const res = await app.request("http://localhost/v1/4p/webhook?token=secret_token_in_url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    assertEquals(res.status, 400);
    const body = await res.json();
    assertEquals(body, { error: "missing_token" });
  } finally {
    if (prevApiKey) Deno.env.set("FOURP_API_KEY", prevApiKey);
    else Deno.env.delete("FOURP_API_KEY");
  }
});

Deno.test("POST /v1/4p/webhook rejects query string notification_token (?notification_token=...) with 400 missing_token", async () => {
  const prevApiKey = Deno.env.get("FOURP_API_KEY");
  Deno.env.set("FOURP_API_KEY", "test_fourp_api_key");

  try {
    const app = createFourPApp();
    const res = await app.request(
      "http://localhost/v1/4p/webhook?notification_token=secret_notif_token_in_url",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      },
    );

    assertEquals(res.status, 400);
    const body = await res.json();
    assertEquals(body, { error: "missing_token" });
  } finally {
    if (prevApiKey) Deno.env.set("FOURP_API_KEY", prevApiKey);
    else Deno.env.delete("FOURP_API_KEY");
  }
});

Deno.test("redactSensitiveQueryParams redacts bearer and token query parameters", () => {
  const url1 = "https://api.slippay.cc/api/v1/4p/webhook?token=supersecret123&foo=bar";
  const redacted1 = redactSensitiveQueryParams(url1);
  assert(!redacted1.includes("supersecret123"));
  assert(redacted1.includes("REDACTED"));
  assert(redacted1.includes("foo=bar"));

  const url2 = "/v1/4p/webhook?notification_token=notif456&other=1";
  const redacted2 = redactSensitiveQueryParams(url2);
  assert(!redacted2.includes("notif456"));
  assert(redacted2.includes("REDACTED"));

  const url3 = "http://example.com/api?apiKey=key999&password=my_secret_pass_123";
  const redacted3 = redactSensitiveQueryParams(url3);
  assert(!redacted3.includes("key999"));
  assert(!redacted3.includes("my_secret_pass_123"));
  assert(redacted3.includes("REDACTED"));
});

Deno.test("timingSafeEqual performs constant-time string comparison", () => {
  assert(timingSafeEqual("hello_world", "hello_world"));
  assert(!timingSafeEqual("hello_world", "hello_worle"));
  assert(!timingSafeEqual("hello", "hello_world"));
  assert(!timingSafeEqual("", "a"));
  assert(timingSafeEqual("", ""));
});

Deno.test("POST /v1/4p/webhook extracts token from body forms (token, notification_token, notificationToken)", async () => {
  const prevApiKey = Deno.env.get("FOURP_API_KEY");
  Deno.env.set("FOURP_API_KEY", "test_fourp_api_key");

  try {
    const app = createFourPApp();

    for (const payload of [
      { token: "body_token_val" },
      { notification_token: "body_notif_token_val" },
      { notificationToken: "body_camel_token_val" },
    ]) {
      const res = await app.request("http://localhost/v1/4p/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      // The token was found in body, so it proceeds to client call which yields fourp_error / ramp_error (502), NOT missing_token (400)
      assertNotEquals(res.status, 400);
      const body = await res.json();
      assertNotEquals(body.error, "missing_token");
    }
  } finally {
    if (prevApiKey) Deno.env.set("FOURP_API_KEY", prevApiKey);
    else Deno.env.delete("FOURP_API_KEY");
  }
});


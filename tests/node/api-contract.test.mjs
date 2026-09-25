import test from "node:test";
import assert from "node:assert/strict";

import { API, authorityURL, normalizeScan } from "../../console/static/api.js";

const pending = {
  scan_id: "dscan_test12345",
  status: "pending_review",
  document_type: "driver_license",
  country: "DO",
  created_at: "2026-09-25T12:00:00Z",
  updated_at: "2026-09-25T12:00:00Z",
  confirmed_at: null,
  fields: {
    full_name: { value: "Ada Example", confidence: 0.9, evidence: { side: "front" } },
    document_number: { value: "12345678901", confidence: 0.99, last4: "8901" },
  },
  quality: { overall_confidence: 0.94, warnings: ["REVIEW_REQUIRED"] },
  source_lookup: {
    allowlisted: true,
    url: "https://authority.example.test/check",
  },
};

test("normalizes current Document Intelligence scan model", () => {
  const out = normalizeScan(pending);
  assert.equal(out.id, "dscan_test12345");
  assert.equal(out.status, "unverified");
  assert.equal(out.fields.full_name.value, "Ada Example");
  assert.equal(out.fields.full_name.evidence, "front");
  assert.deepEqual(out.warnings, ["REVIEW_REQUIRED"]);
  assert.equal(out.authority, "https://authority.example.test/check");
});

test("confirmed scan masks document number and hides evidence", () => {
  const body = structuredClone(pending);
  body.status = "confirmed";
  body.fields.document_number = {
    value: null,
    confidence: 0.99,
    last4: "8901",
    evidence: { side: "front" },
  };
  body.source_lookup = null;
  const out = normalizeScan(body);
  assert.equal(out.status, "confirmed");
  assert.equal(out.fields.document_number.value, "••••8901");
  assert.equal(out.fields.document_number.evidence, "");
  assert.equal(out.authority, null);
});

test("authority URL is HTTPS allowlist-only", () => {
  assert.equal(
    authorityURL({ allowlisted: true, url: "https://authority.example.test/check" }),
    "https://authority.example.test/check",
  );
  assert.equal(authorityURL({ allowlisted: false, url: "https://authority.example.test" }), null);
  assert.equal(authorityURL({ allowlisted: true, url: "javascript:alert(1)" }), null);
  assert.equal(authorityURL({ allowlisted: true, url: "https://user:pass@authority.example.test" }), null);
});

test("API uses real v1 document paths and JSON base64 scan body", async () => {
  const originalFetch = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url, options = {}) => {
    seen.push({ url: String(url), options });
    if (String(url).endsWith("/v1/documents/scan")) {
      return new Response(JSON.stringify(pending), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    }
    if (String(url).includes("/v1/documents?")) {
      return new Response(JSON.stringify({ items: [pending], next_cursor: null }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error("unexpected request");
  };
  try {
    const api = new API("/api");
    api.context = { tenant_id: "t", operator_id: "o", csrf_token: "csrf" };
    const form = new FormData();
    form.set("front", new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }), "front.png");
    form.set("back", new Blob([new Uint8Array([4, 5])], { type: "image/png" }), "back.png");
    form.set("document_type", "driver_license");
    form.set("country", "DO");
    const result = await api.upload(form);
    assert.equal(result.id, "dscan_test12345");
    const sent = JSON.parse(seen[0].options.body);
    assert.equal(seen[0].url, "/api/v1/documents/scan");
    assert.equal(sent.document_type, "driver_license");
    assert.equal(sent.country, "DO");
    assert.equal(sent.front_image_base64, "AQID");
    assert.equal(sent.back_image_base64, "BAU=");
    await api.recent(null);
    assert.match(seen[1].url, /^\/api\/v1\/documents\?limit=50/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("confirmation sends corrections only", async () => {
  const originalFetch = globalThis.fetch;
  let captured;
  globalThis.fetch = async (url, options = {}) => {
    captured = { url: String(url), options };
    const body = structuredClone(pending);
    body.status = "confirmed";
    body.confirmed_at = "2026-09-25T12:05:00Z";
    body.fields.document_number = { value: null, last4: "8901", confidence: 0.99 };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const api = new API("/api");
    api.context = { tenant_id: "t", operator_id: "o", csrf_token: "csrf" };
    const scan = normalizeScan(pending);
    const result = await api.confirm(scan, { full_name: "Ada Corrected" });
    assert.equal(result.status, "confirmed");
    assert.equal(captured.url, "/api/v1/documents/dscan_test12345/confirm");
    assert.deepEqual(JSON.parse(captured.options.body), {
      corrections: { full_name: "Ada Corrected" },
    });
    assert.equal(captured.options.headers["X-CSRF-Token"], "csrf");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

import { test, expect } from "@playwright/test";
const scan = (extra = {}) => ({
  scan_id: "dscan_test12345",
  status: "pending_review",
  document_type: "driver_license",
  country: "DO",
  created_at: "2026-09-25T12:00:00Z",
  updated_at: "2026-09-25T12:00:00Z",
  confirmed_at: null,
  fields: {
    full_name: {
      value: "Ada Example",
      warnings: ["Check spelling"],
      evidence: "Front, line 2",
      confidence: 0.87,
    },
    document_number: {
      value: "123456789",
      warnings: [],
      evidence: "Front, line 3",
      confidence: 0.99,
    },
    face_embedding: { value: "DO NOT RENDER BIOMETRICS" },
  },
  quality: { overall_confidence: 0.93, warnings: ["OCR requires operator review"] },
  source_lookup: { allowlisted: false, url: "https://authority.example.test/check" },
  ...extra,
});
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jXioAAAAASUVORK5CYII=",
  "base64",
);
async function mockAPI(page, overrides = {}) {
  const calls = [];
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    calls.push(request);
    if (overrides[path]) return overrides[path](route);
    const bodies = {
      "/api/auth/context": {
        tenant_id: "tenant-opaque",
        operator_id: "operator-opaque",
        csrf_token: "test-csrf",
      },
      "/api/v1/documents/scan": scan(),
      "/api/v1/documents": { items: [scan()], next_cursor: null },
      "/api/v1/documents/dscan_test12345": scan(),
      "/api/v1/documents/dscan_test12345/confirm": (() => {
        const confirmed = scan({ status: "confirmed", confirmed_at: "2026-09-25T12:05:00Z" });
        confirmed.fields.document_number = { value: null, last4: "6789", confidence: 0.99 };
        confirmed.quality = { overall_confidence: 0.93, warnings: [] };
        confirmed.source_lookup = null;
        return confirmed;
      })(),
      "/api/healthz": { status: "ok" },
    };
    return route.fulfill({
      status: bodies[path] ? 200 : 404,
      json: bodies[path] || {},
    });
  });
  await page.goto("/");
  return calls;
}
async function upload(page) {
  await page
    .getByLabel("Front image")
    .setInputFiles({ name: "front.png", mimeType: "image/png", buffer: png });
  await page
    .getByLabel("Back image")
    .setInputFiles({ name: "back.png", mimeType: "image/png", buffer: png });
  await expect(page.getByAltText("Front image preview")).toBeVisible();
  await page.getByRole("button", { name: "Extract fields" }).click();
  await expect(
    page.getByRole("heading", { name: "Review extracted fields" }),
  ).toBeVisible();
}
test("scan, correct and explicitly confirm without persisting sensitive values", async ({
  page,
}) => {
  const calls = await mockAPI(page);
  await expect(page.locator("#identity")).toContainText("tenant-opaque");
  await upload(page);
  await expect(page.getByText("Unverified OCR", { exact: true })).toBeVisible();
  await expect(page.getByText("Check spelling")).toBeVisible();
  await expect(page.getByText("Front, line 2")).toBeVisible();
  await expect(page.getByText("DO NOT RENDER BIOMETRICS")).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Open authority website" }),
  ).toHaveCount(0);
  await page.getByLabel("Full name", { exact: true }).fill("Ada Corrected");
  await expect(
    page.getByRole("button", { name: "Confirm fields" }),
  ).toBeDisabled();
  await page
    .getByLabel("I have checked these fields against the document")
    .check();
  await page.getByRole("button", { name: "Confirm fields" }).click();
  await expect(
    page.getByText("Confirmed by operator", { exact: true }),
  ).toBeVisible();
  await expect(page.locator("body")).not.toContainText("123456789");
  await expect(page.locator("body")).toContainText("••••6789");
  const confirm = calls.find((r) => r.url().endsWith("/confirm"));
  expect(confirm.postDataJSON()).toEqual({
    corrections: { full_name: "Ada Corrected", document_number: "123456789" },
  });
  expect(confirm.headers()["x-csrf-token"]).toBe("test-csrf");
  const uploaded = calls.find(
    (r) => r.method() === "POST" && r.url().endsWith("/v1/documents/scan"),
  );
  expect(uploaded.headers()["content-type"]).toContain("application/json");
  expect(uploaded.postDataJSON().document_type).toBe("driver_license");
  expect(uploaded.postDataJSON().country).toBe("DO");
  expect(uploaded.postDataJSON().front_image_base64).toBeTruthy();
  expect(uploaded.postDataJSON().back_image_base64).toBeTruthy();
  expect(
    await page.evaluate(() => [localStorage.length, sessionStorage.length]),
  ).toEqual([0, 0]);
  await expect(page.locator("input[type=file]")).toHaveCount(0);
});
test("confirmation failure keeps editable OCR unverified and supports retry", async ({
  page,
}) => {
  await mockAPI(page, {
    "/api/v1/documents/dscan_test12345/confirm": (r) =>
      r.fulfill({
        status: 409,
        json: { detail: "secret raw number 123456789" },
      }),
  });
  await upload(page);
  await page
    .getByLabel("I have checked these fields against the document")
    .check();
  await page.getByRole("button", { name: "Confirm fields" }).click();
  await expect(page.getByRole("alert")).toContainText("changed");
  await expect(page.getByRole("alert")).not.toContainText("123456789");
  await expect(page.getByText("Unverified OCR", { exact: true })).toBeVisible();
  await expect(
    page.getByLabel("Document number", { exact: true }),
  ).toBeEditable();
});
test("recent scans and confirmed detail never reveal document number or its evidence", async ({
  page,
}) => {
  const confirmed = scan({ status: "confirmed", confirmed_at: "2026-09-25T12:05:00Z" });
  confirmed.fields.document_number = { value: null, last4: "6789", evidence: { side: "front" }, confidence: 0.99 };
  await mockAPI(page, {
    "/api/v1/documents": (r) =>
      r.fulfill({ json: { items: [confirmed], next_cursor: "page2" } }),
    "/api/v1/documents/dscan_test12345": (r) => r.fulfill({ json: confirmed }),
  });
  await page.getByRole("link", { name: "Recent scans" }).click();
  await expect(
    page.getByRole("heading", { name: "Recent scans" }),
  ).toBeVisible();
  await expect(page.locator("body")).not.toContainText("123456789");
  await expect(page.getByRole("button", { name: "Load more" })).toBeVisible();
  await page.getByRole("link", { name: "View dscan_test12345" }).click();
  await expect(
    page.getByText("Confirmed by operator", { exact: true }),
  ).toBeVisible();
  await expect(page.locator("body")).not.toContainText("123456789");
  await expect(
    page.getByRole("button", { name: "Confirm fields" }),
  ).toHaveCount(0);
});
for (const [allowlisted, url, allowed] of [
  [true, "https://authority.example.test/check", true],
  ["true", "https://authority.example.test", false],
  [true, "javascript:alert(1)", false],
  [false, "https://authority.example.test", false],
]) {
  test(`QR link policy ${allowlisted} ${url}`, async ({ page }) => {
    let externalRequests = 0;
    await page.route("https://authority.example.test/**", (r) => {
      externalRequests++;
      return r.abort();
    });
    await mockAPI(page, {
      "/api/v1/documents/dscan_test12345": (r) =>
        r.fulfill({ json: scan({ source_lookup: { allowlisted, url } }) }),
    });
    await page.goto("/#detail/dscan_test12345");
    await expect(
      page.getByRole("heading", { name: "Review extracted fields" }),
    ).toBeVisible();
    const link = page.getByRole("link", { name: "Open authority website" });
    await expect(link).toHaveCount(allowed ? 1 : 0);
    if (allowed) {
      await expect(link).toHaveAttribute("rel", "noopener noreferrer");
      await expect(link).toHaveAttribute("href", url);
    }
    expect(externalRequests).toBe(0);
  });
}
for (const status of [401, 403, 429, 500]) {
  test(`API ${status} renders safe error with retry`, async ({ page }) => {
    await mockAPI(page, {
      "/api/v1/documents": (r) =>
        r.fulfill({ status, json: { detail: "<script>PII</script>" } }),
    });
    await page.getByRole("link", { name: "Recent scans" }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.getByRole("alert")).not.toContainText("PII");
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  });
}
test("missing optional browser identity context falls back to ingress-managed identity", async ({
  page,
}) => {
  await mockAPI(page, {
    "/api/auth/context": (r) => r.fulfill({ status: 401, json: {} }),
  });
  await expect(page.locator("#identity")).toContainText("managed-by-ingress");
  await expect(page.getByRole("button", { name: "Extract fields" })).toBeVisible();
  await page.getByRole("link", { name: "Health & system" }).click();
  await expect(
    page.getByRole("heading", { name: "Health & system" }),
  ).toBeVisible();
  await expect(page.getByText("API available", { exact: true })).toBeVisible();
});
test("malformed scan response does not imply confirmation", async ({
  page,
}) => {
  await mockAPI(page, {
    "/api/v1/documents/dscan_test12345": (r) =>
      r.fulfill({ json: { scan_id: "dscan_test12345", status: "unexpected" } }),
  });
  await page.goto("/#detail/dscan_test12345");
  await expect(page.getByRole("alert")).toContainText("unexpected response");
});
test("mobile layout does not overflow and previews are cleared on navigation", async ({
  page,
}) => {
  await mockAPI(page);
  await page
    .getByLabel("Front image")
    .setInputFiles({ name: "front.png", mimeType: "image/png", buffer: png });
  await expect(page.getByAltText("Front image preview")).toBeVisible();
  await page.getByRole("link", { name: "Recent scans" }).click();
  await page.getByRole("link", { name: "Scan document", exact: true }).click();
  await expect(page.getByAltText("Front image preview")).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("metadata-only recent scans paginate without retaining fields", async ({
  page,
}) => {
  await mockAPI(page, {
    "/api/v1/documents": (r) =>
      r.fulfill({
        json: r.request().url().includes("cursor=")
          ? {
              items: [{ scan_id: "dscan_test45678", status: "failed", created_at: "2026-09-25T12:01:00Z" }],
              next_cursor: null,
            }
          : {
              items: [
                {
                  scan_id: "dscan_test12345",
                  status: "pending_review",
                  created_at: "2026-09-25T12:00:00Z",
                },
              ],
              next_cursor: "dscan_cursor12345",
            },
      }),
  });
  await page.getByRole("link", { name: "Recent scans" }).click();
  await expect(page.getByRole("link", { name: "View dscan_test12345" })).toBeVisible();
  await page.getByRole("button", { name: "Load more" }).click();
  await expect(page.getByRole("link", { name: "View dscan_test45678" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Load more" })).toBeHidden();
});
test("leaving a pending health request never appends content to another page", async ({
  page,
}) => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  await mockAPI(page, {
    "/api/healthz": async (r) => {
      await gate;
      await r.fulfill({ json: { status: "ok" } });
    },
  });
  await page.getByRole("link", { name: "Health & system" }).click();
  await expect(page.getByText("Checking API…")).toBeVisible();
  await page.getByRole("link", { name: "Scan document", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Extract fields" }),
  ).toBeVisible();
  release();
  await expect(
    page.getByRole("heading", { name: "Data handling" }),
  ).toHaveCount(0);
});
test("API text stays inert and input edits reset acknowledgement", async ({
  page,
}) => {
  const record = scan();
  record.fields.full_name.value = "<img src=x onerror=alert(1)>";
  record.fields.full_name.evidence = "<script>window.injected=true</script>";
  await mockAPI(page, {
    "/api/v1/documents/dscan_test12345": (r) => r.fulfill({ json: record }),
  });
  await page.goto("/#detail/dscan_test12345");
  await expect(page.getByLabel("Full name", { exact: true })).toHaveValue(
    "<img src=x onerror=alert(1)>",
  );
  await expect(page.locator("main img")).toHaveCount(0);
  expect(await page.evaluate(() => window.injected)).toBeUndefined();
  await page
    .getByLabel("I have checked these fields against the document")
    .check();
  await page.getByLabel("Full name", { exact: true }).fill("Edited again");
  await expect(
    page.getByRole("button", { name: "Confirm fields" }),
  ).toBeDisabled();
});
test("network failure can recover and malformed success cannot confirm a scan", async ({
  page,
}) => {
  let fail = true;
  await mockAPI(page, {
    "/api/v1/documents": (r) =>
      fail ? r.abort() : r.fulfill({ json: { items: [], next_cursor: null } }),
    "/api/v1/documents/dscan_test12345/confirm": (r) => r.fulfill({ json: scan() }),
  });
  await page.getByRole("link", { name: "Recent scans" }).click();
  await expect(page.getByRole("alert")).toContainText("Unable to reach");
  fail = false;
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(
    page.getByRole("heading", { name: "No scans yet" }),
  ).toBeVisible();
  await page.goto("/#detail/dscan_test12345");
  await page
    .getByLabel("I have checked these fields against the document")
    .check();
  await page.getByRole("button", { name: "Confirm fields" }).click();
  await expect(page.getByRole("alert")).toContainText("unexpected response");
  await expect(page.getByText("Unverified OCR", { exact: true })).toBeVisible();
});
test("skip navigation focuses review content without losing corrections", async ({
  page,
}) => {
  await mockAPI(page);
  await page.goto("/#detail/dscan_test12345");
  await page
    .getByLabel("Full name", { exact: true })
    .fill("Preserve this correction");
  await page.getByRole("link", { name: "Skip to content" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main")).toBeFocused();
  await expect(page.getByLabel("Full name", { exact: true })).toHaveValue(
    "Preserve this correction",
  );
  await expect(page).toHaveURL(/#detail\/dscan_test12345$/);
});

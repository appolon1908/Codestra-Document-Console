// The sole Document Intelligence wire adapter. Never fetch QR destinations.
export const FIELD_LABELS = Object.freeze({
  full_name: "Full name",
  given_names: "Given names",
  surname: "Surname",
  document_number: "Document number",
  document_type: "Document type",
  date_of_birth: "Date of birth",
  expiry_date: "Expiry date",
  issue_date: "Issue date",
  nationality: "Nationality",
  issuing_country: "Issuing country",
});
const malformed = () =>
  new Error(
    "The API returned an unexpected response. Try again or contact your administrator.",
  );
const str = (value) => typeof value === "string";
export function authorityURL(qr) {
  if (qr?.allowlisted !== true || !str(qr.url)) return null;
  try {
    const url = new URL(qr.url);
    return url.protocol === "https:" && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}
function scanMetadata(raw) {
  if (
    !raw ||
    !str(raw.id) ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(raw.id) ||
    !["unverified", "confirmed", "processing", "failed"].includes(raw.status)
  )
    throw malformed();
  return {
    id: raw.id,
    status: raw.status,
    created_at: str(raw.created_at) ? raw.created_at : "",
  };
}
export function normalizeScan(raw) {
  const metadata = scanMetadata(raw);
  const confirmed = raw.status === "confirmed";
  const fields = {};
  for (const key of Object.keys(FIELD_LABELS)) {
    const f = raw.fields?.[key];
    if (!f) continue;
    if (f.value !== null && !str(f.value)) throw malformed();
    let value = f.value || "";
    if (confirmed && key === "document_number")
      value = value.length > 4 ? `••••${value.slice(-4)}` : "••••";
    fields[key] = {
      value,
      // Do not retain post-confirmation free text: it can contain the raw number.
      evidence: !confirmed && str(f.evidence) ? f.evidence : "",
      warnings:
        !confirmed && Array.isArray(f.warnings) ? f.warnings.filter(str) : [],
      confidence:
        typeof f.confidence === "number" &&
        f.confidence >= 0 &&
        f.confidence <= 1
          ? f.confidence
          : null,
    };
  }
  if (
    raw.status === "unverified" &&
    (!str(raw.version) || !Object.keys(fields).length)
  )
    throw malformed();
  return {
    ...metadata,
    version: str(raw.version) ? raw.version : "",
    fields,
    warnings:
      !confirmed && Array.isArray(raw.warnings) ? raw.warnings.filter(str) : [],
    authority: authorityURL(raw.qr),
  };
}
export class API {
  constructor(base) {
    this.base = base;
    this.context = null;
  }
  async request(path, { method = "GET", body, signal } = {}) {
    const headers = { Accept: "application/json" };
    if (method !== "GET") {
      if (!this.context?.csrf_token)
        throw new Error(
          "Operator context is unavailable. Reload to authenticate.",
        );
      headers["X-CSRF-Token"] = this.context.csrf_token;
      if (!(body instanceof FormData)) {
        headers["Content-Type"] = "application/json";
        body = JSON.stringify(body);
      }
    }
    let response;
    try {
      response = await fetch(this.base + path, {
        method,
        body,
        headers,
        credentials: "include",
        cache: "no-store",
        redirect: "error",
        referrerPolicy: "no-referrer",
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(60000)])
          : AbortSignal.timeout(60000),
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new Error(
        "Unable to reach the API. Check your connection and try again. The operation may have completed; check Recent scans before resubmitting.",
      );
    }
    if (!response.ok) {
      const messages = {
        401: "Your session has expired. Sign in through your organization’s ingress, then try again.",
        403: "Your operator context does not permit this action. Contact your administrator.",
        404: "This scan is unavailable or does not belong to your operator context.",
        409: "This scan changed since it was loaded. Reload the scan before confirming.",
        413: "The images exceed the API upload limit. Choose smaller images.",
        422: "The API could not accept these fields or images. Check your input and retry.",
        429: "The API is busy. Wait a moment before trying again.",
      };
      if (response.status === 401 || response.status === 403)
        this.context = null;
      // Never reflect server error bodies: they may contain OCR or internal details.
      throw new Error(
        messages[response.status] ||
          "The API is unavailable. Try again shortly.",
      );
    }
    try {
      return await response.json();
    } catch {
      throw malformed();
    }
  }
  async identity(signal) {
    const raw = await this.request("/auth/context", { signal });
    if (
      !raw ||
      !["tenant_id", "operator_id", "csrf_token"].every(
        (k) => str(raw[k]) && raw[k].length,
      )
    )
      throw malformed();
    this.context = {
      tenant_id: raw.tenant_id,
      operator_id: raw.operator_id,
      csrf_token: raw.csrf_token,
    };
    return this.context;
  }
  async scan(id, signal) {
    return normalizeScan(
      await this.request(`/scans/${encodeURIComponent(id)}`, { signal }),
    );
  }
  async recent(cursor, signal) {
    const raw = await this.request(
      `/scans${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
      { signal },
    );
    if (
      !raw ||
      !Array.isArray(raw.items) ||
      (raw.next_cursor != null && !str(raw.next_cursor))
    )
      throw malformed();
    return {
      items: raw.items.map((item) => {
        // Lists keep metadata only, never extracted fields.
        return scanMetadata(item);
      }),
      next: raw.next_cursor || null,
    };
  }
  async upload(form, signal) {
    return normalizeScan(
      await this.request("/scans", { method: "POST", body: form, signal }),
    );
  }
  async confirm(scan, fields, signal) {
    const result = normalizeScan(
      await this.request(`/scans/${encodeURIComponent(scan.id)}/confirm`, {
        method: "POST",
        body: { fields, version: scan.version },
        signal,
      }),
    );
    if (result.status !== "confirmed" || result.id !== scan.id)
      throw malformed();
    return result;
  }
  async health(signal) {
    const raw = await this.request("/health", { signal });
    if (!raw || !["ok", "degraded", "unavailable"].includes(raw.status))
      throw malformed();
    return {
      status: raw.status,
      version: str(raw.version) ? raw.version : "Not reported",
    };
  }
}

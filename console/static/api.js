// Browser adapter for the standalone Document Intelligence API.
// Cross-system traffic is expected to traverse Caddy -> Kong -> Middleware V3.
// The browser never receives or forwards the Document Intelligence workload token.

export const FIELD_LABELS = Object.freeze({
  full_name: "Full name",
  given_names: "Given names",
  surnames: "Surnames",
  surname: "Surname",
  document_number: "Document number",
  address: "Address",
  height: "Height",
  weight_lb: "Weight (lb)",
  sex: "Sex",
  blood_type: "Blood type",
  date_of_birth: "Date of birth",
  birth_date: "Birth date",
  expiry_date: "Expiry date",
  issue_date: "Issue date",
  first_issue_date: "First issue date",
  category: "Category",
  restriction: "Restriction",
  card_serial: "Card serial",
  nationality: "Nationality",
  issuing_country: "Issuing country",
});

const malformed = () =>
  new Error("The API returned an unexpected response. Try again or contact your administrator.");
const str = (value) => typeof value === "string";

function uiStatus(status) {
  return ({
    pending_review: "unverified",
    confirmed: "confirmed",
    failed: "failed",
    unverified: "unverified",
    processing: "processing",
  })[status] || null;
}

function labelFor(key) {
  return FIELD_LABELS[key] || key.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());
}

function evidenceText(evidence) {
  if (str(evidence)) return evidence;
  if (!evidence || typeof evidence !== "object") return "";
  const parts = [];
  if (str(evidence.side)) parts.push(evidence.side);
  if (Array.isArray(evidence.bbox) && evidence.bbox.every((n) => typeof n === "number"))
    parts.push(`bbox ${evidence.bbox.join(", ")}`);
  return parts.join(" · ");
}

export function authorityURL(qr) {
  const candidate = qr?.url ?? qr?.source_lookup_url;
  const allowed = qr?.allowlisted === true;
  if (!allowed || !str(candidate)) return null;
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

function scanMetadata(raw) {
  const id = raw?.scan_id ?? raw?.id;
  const status = uiStatus(raw?.status);
  if (!raw || !str(id) || !/^dscan_[A-Za-z0-9_-]{8,128}$/.test(id) || !status)
    throw malformed();
  return {
    id,
    status,
    created_at: str(raw.created_at) ? raw.created_at : "",
  };
}

export function normalizeScan(raw) {
  const metadata = scanMetadata(raw);
  const confirmed = metadata.status === "confirmed";
  const fields = {};
  for (const [key, f] of Object.entries(raw.fields || {})) {
    if (!f || typeof f !== "object") continue;
    if (/(embedding|biometric|raw_image|portrait_image)/i.test(key)) continue;
    if (f.value !== null && f.value !== undefined && !str(f.value)) throw malformed();
    let value = f.value || "";
    if (confirmed && key === "document_number") {
      const last4 = f.last4 || raw.document?.number_last4 || "";
      value = last4 ? `••••${last4}` : "••••";
    }
    fields[key] = {
      label: labelFor(key),
      value,
      evidence: confirmed ? "" : evidenceText(f.evidence),
      warnings:
        !confirmed && Array.isArray(f.warnings) ? f.warnings.filter(str) : [],
      confidence:
        typeof f.confidence === "number" && f.confidence >= 0 && f.confidence <= 1
          ? f.confidence
          : null,
    };
  }

  return {
    ...metadata,
    version: str(raw.updated_at) ? raw.updated_at : str(raw.version) ? raw.version : "",
    fields,
    warnings:
      !confirmed && Array.isArray(raw.quality?.warnings)
        ? raw.quality.warnings.filter(str)
        : !confirmed && Array.isArray(raw.warnings)
          ? raw.warnings.filter(str)
          : [],
    authority: authorityURL(raw.source_lookup || raw.qr),
    document_type: raw.document_type || "",
    country: raw.country || "",
  };
}

async function fileBase64(file) {
  if (!(file instanceof Blob)) throw new Error("Choose a document image.");
  const buffer = await file.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk)
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}

export class API {
  constructor(base) {
    this.base = base;
    this.context = null;
  }

  async request(path, { method = "GET", body, signal } = {}) {
    const headers = { Accept: "application/json" };
    if (method !== "GET" && this.context?.csrf_token)
      headers["X-CSRF-Token"] = this.context.csrf_token;
    if (method !== "GET" && body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(body);
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
        400: "The request could not be accepted. Check the document details.",
        401: "Your session has expired. Sign in through your organization’s ingress, then try again.",
        403: "Your operator context does not permit this action. Contact your administrator.",
        404: "This scan is unavailable or does not belong to your tenant.",
        409: "This scan changed since it was loaded. Reload it before confirming.",
        413: "The images exceed the API upload limit. Choose smaller images.",
        422: "The API could not accept these fields or images. Check your input and retry.",
        429: "The API is busy. Wait a moment before trying again.",
        502: "OCR returned an invalid response. Try again or contact your administrator.",
        503: "Document Intelligence or OCR is temporarily unavailable.",
      };
      if (response.status === 401 || response.status === 403) this.context = null;
      throw new Error(messages[response.status] || "The API is unavailable. Try again shortly.");
    }

    try {
      return await response.json();
    } catch {
      throw malformed();
    }
  }

  async identity(signal) {
    // Identity belongs to Middleware/Keycloak. This optional route is an ingress
    // convenience only; the console never implements or persists its own user DB.
    try {
      const raw = await this.request("/auth/context", { signal });
      if (
        raw &&
        ["tenant_id", "operator_id"].every((k) => str(raw[k]) && raw[k].length)
      ) {
        this.context = {
          tenant_id: raw.tenant_id,
          operator_id: raw.operator_id,
          csrf_token: str(raw.csrf_token) ? raw.csrf_token : null,
        };
        return this.context;
      }
    } catch {
      // A direct Document Intelligence route does not expose browser identity.
    }
    this.context = {
      tenant_id: "managed-by-ingress",
      operator_id: "managed-by-ingress",
      csrf_token: null,
    };
    return this.context;
  }

  async scan(id, signal) {
    return normalizeScan(
      await this.request(`/v1/documents/${encodeURIComponent(id)}`, { signal }),
    );
  }

  async recent(cursor, signal) {
    const query = new URLSearchParams({ limit: "50" });
    if (cursor) query.set("cursor", cursor);
    const raw = await this.request(`/v1/documents?${query}`, { signal });
    if (
      !raw ||
      !Array.isArray(raw.items) ||
      (raw.next_cursor != null && !str(raw.next_cursor))
    )
      throw malformed();
    return {
      items: raw.items.map(scanMetadata),
      next: raw.next_cursor || null,
    };
  }

  async upload(form, signal) {
    const front = form.get("front");
    const back = form.get("back");
    const documentType = String(form.get("document_type") || "driver_license");
    const country = String(form.get("country") || "DO");
    const body = {
      document_type: documentType,
      country,
      front_image_base64: await fileBase64(front),
      back_image_base64: back instanceof Blob && back.size ? await fileBase64(back) : null,
    };
    return normalizeScan(
      await this.request("/v1/documents/scan", { method: "POST", body, signal }),
    );
  }

  async confirm(scan, fields, signal) {
    const result = normalizeScan(
      await this.request(`/v1/documents/${encodeURIComponent(scan.id)}/confirm`, {
        method: "POST",
        body: { corrections: fields },
        signal,
      }),
    );
    if (result.status !== "confirmed" || result.id !== scan.id) throw malformed();
    return result;
  }

  async health(signal) {
    const raw = await this.request("/healthz", { signal });
    if (!raw || raw.status !== "ok") throw malformed();
    return { status: "ok", version: "v1" };
  }
}

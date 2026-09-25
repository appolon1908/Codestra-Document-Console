# Assumed Document Intelligence API contract

This is a proposed integration boundary, not a claim about a deployed API. All
paths below are relative to `DOCUMENT_API_BASE_URL` (default `/api`). Adapt
`console/static/api.js` if the authoritative service contract differs. The static
host only exposes `/`, `/static/*`, `/config`, and `/healthz`.

## Authentication and transport

The browser sends `credentials: include`, `Accept: application/json`, `cache:
no-store`, no referrer, and rejects redirects. Ingress authenticates the session;
the API derives tenant/operator scope from that authenticated context. No tenant,
operator, role, or authorization claims are sent from form fields. Every API route,
including detail/list/confirmation, must independently authorize tenant access.

`GET /auth/context` returns:

```json
{"tenant_id":"tenant-opaque","operator_id":"operator-opaque","csrf_token":"session-bound-token"}
```

Both identity values are displayed literally as text. The token remains in memory,
is never displayed, and is sent as `X-CSRF-Token` on mutations. API/ingress must
validate that session-bound token and the request Origin. The console does not
implement login or issue cookies. Expired or forbidden sessions disable further
mutations until context is fetched successfully.

## Endpoints

| Method | Path | Response / request |
| --- | --- | --- |
| GET | `/auth/context` | Auth context above |
| POST | `/scans` | Multipart `front` (required), `back` (optional); returns scan |
| GET | `/scans?cursor=opaque` | `{"items":[{"id":"scan-123","status":"unverified","created_at":"2026-09-25T12:00:00Z"}],"next_cursor":null}`; cursor omitted on first page |
| GET | `/scans/{id}` | Scan |
| POST | `/scans/{id}/confirm` | JSON `{"fields":{"full_name":"Corrected name","document_number":"123456789"},"version":"v1"}`; returns confirmed scan |
| GET | `/health` | `{"status":"ok","version":"release-id"}`; status can also be `degraded` or `unavailable` |

All successful responses are JSON (200, 201, or 202 as appropriate). Scan IDs
must match `[A-Za-z0-9_-]{1,128}`. A scan has this shape:

```json
{
  "id": "scan-123",
  "status": "unverified",
  "created_at": "2026-09-25T12:00:00Z",
  "version": "v1",
  "fields": {
    "full_name": {
      "value": "Ada Example",
      "confidence": 0.87,
      "warnings": ["Check spelling"],
      "evidence": "Front, line 2"
    },
    "document_number": {
      "value": "123456789",
      "confidence": 0.99,
      "warnings": [],
      "evidence": "Front, line 3"
    }
  },
  "warnings": ["OCR requires operator review"],
  "qr": {"allowlisted": true, "url": "https://authority.example/check"}
}
```

Statuses: `unverified`, `confirmed`, `processing`, `failed`. Unverified details
require a nonempty supported field set and a string `version`. Processing/failed
responses can omit fields; the operator refreshes them manually. No automatic
polling or mutation retries. Confirmation must atomically validate `version`,
record authenticated operator/audit details in the API, apply corrections, and
return `confirmed` with the same ID. A conflict returns 409 and requires reload.
The acknowledgement resets when a field changes.

Supported editable keys: `full_name`, `given_names`, `surname`, `document_number`,
`document_type`, `date_of_birth`, `expiry_date`, `issue_date`, `nationality`,
`issuing_country`. Values are strings or null. Unknown keys are discarded; no
face/image/biometric field is displayed, processed, or submitted. Confidence is
optional and ranges from 0 to 1. Evidence is plain text, never HTML or image URLs.

After confirmation the adapter masks the document number to its last four
characters (fully masks values of four or fewer characters), drops free-text
warnings/evidence, and displays read-only values. The API should itself return
only masked document numbers for confirmed records and only metadata for lists.
Masking here is a display safeguard, not API authorization or a guarantee that an
API response cannot be inspected in developer tools.

QR links are rendered only for boolean `allowlisted: true` and an HTTPS URL with
no credentials. The API owns the destination allowlist. The console never tests,
resolves, fetches, previews, or automatically opens the destination. Links use
`noopener noreferrer` and require an operator click.

## Errors and resource limits

401/403, 404, 409, 413, 422, 429, and 5xx have safe local messages. Raw error bodies
are never rendered or logged. Unexpected JSON and invalid records fail closed.
Requests time out after 60 seconds; navigation aborts pending requests and rejects
late results. A timeout/abort can occur after the API accepted a write: check
recent scans before resubmitting. The API must enforce quotas, actual image
format/content, file-size limits, and mutation concurrency. The browser accepts
nonempty JPG/PNG/WebP files up to 10 MiB per side as a convenience check only.

API responses containing document data must set `Cache-Control: no-store`.
Production ingress must not log request/response bodies, CSRF tokens, cookies,
or extracted fields. Configure image retention only at the API, under its policy.

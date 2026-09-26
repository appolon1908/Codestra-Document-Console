# Document Console API contract

The Console is a standalone presentation product. It does not own identity, OCR, document persistence, or biometric data.

Production request path:

`Browser -> Caddy -> Kong -> Middleware V3 -> Document Intelligence`

The browser never receives the Document Intelligence workload credential. Middleware/Keycloak own the authenticated operator and tenant context.

## Document Intelligence endpoints used by the Console

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/healthz` | Liveness |
| GET | `/v1/documents?limit=50&cursor=...` | Tenant-scoped recent scan summaries |
| POST | `/v1/documents/scan` | Create scan from JSON base64 front/back images |
| GET | `/v1/documents/{scan_id}` | Read one tenant-scoped scan |
| POST | `/v1/documents/{scan_id}/confirm` | Confirm operator corrections |

The optional `/auth/context` route is an ingress convenience for displaying opaque tenant/operator identifiers. The Console falls back to “managed by ingress” when this display endpoint is absent. It never implements its own user database.

## Scan request

`POST /v1/documents/scan`

```json
{
  "document_type": "driver_license",
  "country": "DO",
  "front_image_base64": "<base64>",
  "back_image_base64": "<base64 or null>"
}
```

The Console accepts JPEG and PNG only and applies the same 8 MiB-per-image convenience bound as the current API. Document Intelligence remains authoritative for all image validation.

## Review and confirmation

Document Intelligence reports new scan sessions with status `pending_review`. The Console renders this as **Unverified OCR**.

`POST /v1/documents/{scan_id}/confirm`

```json
{
  "corrections": {
    "full_name": "Corrected name",
    "document_number": "12345678901"
  }
}
```

After confirmation the Console must not display the clear document number. It uses only masked/last-four information returned by Document Intelligence.

## Privacy and trust rules

- Raw document images are not stored by the Console.
- Browser localStorage/sessionStorage are not used for document data.
- No biometric fields are rendered.
- OCR is never presented as authenticity verification.
- QR/source URLs are shown only when Document Intelligence reports them as allowlisted HTTPS destinations.
- The Console never fetches authority QR destinations server-side.
- Server error bodies are never reflected into the UI.
- Tenant isolation and authorization are enforced by Middleware/Document Intelligence, not by client-side code.

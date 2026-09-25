# Deployment

## Topology

```text
Browser -> HTTPS Caddy / Kong / Middleware ingress
             /api/* -> Document Intelligence API
             /*     -> document-console:8080 (static host)
```

The console server has no outbound API client. Browser API traffic is direct to
the configured API ingress. Use `DOCUMENT_API_BASE_URL=/api` for same-origin
sessions. Absolute HTTPS bases are supported and automatically added to
`connect-src`; credentialed CORS must allow the exact console origin, methods
GET/POST, and `X-CSRF-Token`/`Content-Type`. Never use wildcard origins with cookies.
API base is public runtime configuration, never a location for credentials.

Use your existing ingress authentication integration. It must authenticate the
session and provide verified identity to the API; strip spoofable inbound identity
headers before adding trusted ones. API owns roles, tenant isolation, CSRF
validation, concurrency, audit records, storage, and retention. The console neither
creates users nor accepts browser-supplied tenant/operator selectors. Use Secure,
HttpOnly session cookies and a SameSite policy appropriate to the deployment.

## Container

```sh
docker build -t codestra-document-console:local .
docker run -d --name document-console \
  --read-only --cap-drop ALL --security-opt no-new-privileges \
  --memory 128m --cpus 1 \
  -p 127.0.0.1:8080:8080 \
  -e DOCUMENT_API_BASE_URL=/api \
  codestra-document-console:local
```

The image runs as UID/GID 10001 and needs no mounted data volume. Place it on the
same private container network as the ingress for normal deployment; avoid
publishing the port except for local checks. Pin the tested image digest in your
release manifests. `GET /healthz` is a local liveness probe, not an API readiness
check. A healthy static host can still show an API outage.

Caddy routing example (attach your existing auth middleware; this snippet alone
is **not** an authentication deployment):

```caddyfile
console.example.com {
    header Strict-Transport-Security "max-age=31536000"
    handle_path /api/* {
        request_body {
            max_size 21MB
        }
        reverse_proxy document-intelligence-api:8000
    }
    handle {
        reverse_proxy document-console:8080
    }
}
```

`handle_path` removes `/api`; preserve the prefix instead if the API expects it.
Kong/Middleware equivalents need the same route split and trusted auth context.
Configure ingress timeout above the browser's 60-second request timeout, or use
the API's asynchronous `processing` response and manual refresh. Disable proxy
cache/body capture for document routes. Upload limits should accommodate two
10 MiB images plus multipart overhead. Do not add QR-fetching or image-fetching
middleware to this console route.

## Release validation

1. Run the Python and desktop/mobile browser suites and package/container builds.
2. Validate `docs/api-contract.md` against the actual API; test a synthetic document
   end to end through the real ingress, including correction and version conflict.
3. Verify expired sessions and cross-tenant access are rejected by the API. Verify
   CSRF rejection with missing/incorrect token, not just the browser happy path.
4. Verify response `no-store`, logs contain no document bodies/tokens, and uploads
   reach the API without being stored by the console or ingress buffering policy.
5. Confirm API allowlist decisions, operator-click-only authority navigation, and
   masked confirmed records. Confirm the API itself returns minimal data.

Rollback by restoring the previous container digest. There are no console database
migrations. Runtime base changes require a process restart and browser reload.

## Privacy boundaries

Previews use object URLs and are revoked on replacement/navigation/successful
upload/page exit. Form inputs and confirmation buffers are cleared after success.
No browser storage or cache is intentionally used. JavaScript cannot guarantee
physical memory erasure or control browser extensions, developer tools, screenshots,
or the API's retention; deploy within your managed operator environment. Review
pages intentionally display unverified document data until the operator confirms
or leaves. No camera capture, face extraction, recognition, or biometric matching
exists in this application.

See [foundation validation](validation.md) for checks performed and runtime limitations.

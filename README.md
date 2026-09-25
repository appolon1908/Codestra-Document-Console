# Codestra Document Console

A lightweight human-review workspace for Document Intelligence. FastAPI serves a
responsive, dependency-free browser UI. Only the browser contacts the Document
Intelligence API; the console has no document database, image upload endpoint,
HTTP proxy, or user database.

## Features

- Front/back image selection and local browser previews; direct multipart API upload.
- Unverified OCR review, editable fields, confidence, warnings, and evidence.
- Explicit operator acknowledgement and versioned confirmation; failed confirmations
  remain unverified. Document numbers are masked after API-confirmed success.
- Recent scans, cursor pagination, scan detail, processing/failed states, and system health.
- Opaque tenant/operator identity from API auth context. No tenant selector or local users.
- QR authority links require API `allowlisted: true` and HTTPS, and open only on click.
- No biometric/face features, browser storage, service workers, third-party scripts,
  analytics, or console-side image retention.

## Run locally

Requires Python 3.11+ (container: 3.12).

```sh
python -m venv .venv
.venv/bin/pip install -r requirements.lock
.venv/bin/pip install -e '.[test]'
DOCUMENT_API_BASE_URL=/api .venv/bin/uvicorn console.app:create_app --factory --port 8080 --no-access-log
```

Open `http://localhost:8080`. Route `/api/*` to your API through an ingress for a
working authenticated session, or set `DOCUMENT_API_BASE_URL` to an HTTPS API URL
with appropriate credentialed CORS. Without an API, the console displays a safe
connection error. There is no demo authentication bypass. `.env.example` is a
reference; environment files are not automatically loaded.

**Integration status:** this repository was empty and supplied no existing API
contract. The adapter implements the explicit [assumed API contract](docs/api-contract.md).
Validate those routes, field names, CSRF behavior, and version semantics against the
actual Document Intelligence service before deployment. Browser tests simulate
that contract; they do not establish live API compatibility.

## Test and build

```sh
.venv/bin/pytest -q
npm ci
npx playwright install chromium
npm test
npm run build
.venv/bin/python -m build

docker build -t codestra-document-console:local .
docker run --rm -p 8080:8080 -e DOCUMENT_API_BASE_URL=/api codestra-document-console:local
```

If Chrome is already installed, use `PLAYWRIGHT_CHANNEL=chrome npm test` instead of
downloading Chromium. Tests exercise desktop and mobile views, multipart uploads,
corrections, masking, QR policy, identity, API failures, and rendering. Test reports
must use synthetic data; traces and automatic screenshots are disabled. The JS
build is a syntax check because the shipped modules require no bundler.

`GET /healthz` checks only the static host. The system page separately calls API
health. Runtime configuration is available at `GET /config` and must contain no
secrets. See [deployment](docs/deployment.md), [API contract](docs/api-contract.md),
and [design](docs/design.md).

# Document Intelligence console design and execution plan

The operator uploads front/back images, reviews unverified OCR and API evidence,
corrects fields, explicitly confirms, and revisits scans. Identity and authorization
belong to the API/ingress. The console has no database or remote HTTP client.

FastAPI serves HTML/CSS/ES modules, runtime configuration, and liveness. The browser
uses one configurable API base and cookie authentication with an API-issued CSRF
token. Same-origin ingress routing is the production default. Browser uploads go
straight to the API. Object URLs are revoked and file inputs cleared on navigation,
upload completion, and page exit. No local/session storage, analytics, or service
worker. Unknown fields are excluded, including biometric content.

The repository has no API contract. docs/api-contract.md defines the assumed wire
contract; static/api.js is the integration boundary. This assumption requires
validation against the deployed API before production release.

Implementation sequence:
1. Add failing HTTP tests for shell/config/health/security and invalid API bases.
2. Implement static FastAPI host with no upload/proxy endpoints.
3. Add browser tests using a simulated API for scan, confirmation, privacy,
   allowlisted QR links, identity, pagination, and error states.
4. Implement responsive UI and isolated API adapter; run browser tests.
5. Document deployment/auth and contract; package non-root container.
6. Run full Python/browser suites, syntax/package/container builds where available,
   inspect diffs, commit and push the existing mission branch. No merge.

Review focus: expired auth, malformed API data, stale asynchronous responses,
failed confirmation (must stay unverified), sensitive data after confirmation,
redirects and QR links, mobile overflow, unknown/biometric API fields.

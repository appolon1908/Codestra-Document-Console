# Foundation validation — 2026-09-25

- Python HTTP suite: **10 passed** (`.venv/bin/pytest -q`). One upstream Starlette
  TestClient/httpx deprecation warning; no failing tests.
- Browser suite: **38 passed**, desktop 1440×1000 and mobile 390×844, using installed
  Chrome (`PLAYWRIGHT_CHANNEL=chrome npm test`). Playwright's bundled Chromium
  installer does not support this host's Ubuntu 26.04 identification, so Chrome
  was used. Environment color-variable warnings do not affect test results.
- JavaScript syntax build and Prettier checks passed.
- Python source distribution and wheel built successfully, including static assets.
- Docker image built successfully with the pinned runtime dependencies.
- Container smoke: non-root UID/GID 10001, read-only filesystem, local health 200
  with `no-store`, and packaged application module served. Healthcheck healthy.
- Desktop/mobile scan page screenshots inspected; no clipping or horizontal overflow.
- Independent read-only code review found a skip-link navigation defect; regression
  test reproduced it, and the final suites pass with the fix.

Browser tests use synthetic API responses matching the proposed contract. No live
Document Intelligence API or ingress was available; end-to-end compatibility,
tenant authorization, CSRF enforcement, and backend retention remain deployment
validation requirements in `deployment.md`.

The hardened runtime invocation with both `--cap-drop ALL` and
`--security-opt no-new-privileges` failed before application startup with
`exec /usr/local/bin/uvicorn: operation not permitted`. Invoking Python with the
same flags also failed. The non-root read-only invocation succeeded. Validate the
full hardening flags in the target runtime; this session does not establish their
compatibility here.

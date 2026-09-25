"""No API proxy, image processing, persistence, or identity database lives here."""
import os
import re
from pathlib import Path
from urllib.parse import urlsplit

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

STATIC = Path(__file__).parent / "static"


def api_config(raw: str) -> tuple[str, str]:
    if not raw or re.search(r"[\s\\;'\"<>?#]", raw):
        raise ValueError("API base must be a root-relative path or an HTTPS URL")
    parsed = urlsplit(raw)
    if raw.startswith("/") and not raw.startswith("//"):
        origin = ""
    elif parsed.scheme == "https" and parsed.hostname and not parsed.username and not parsed.password:
        # Accessing port also validates malformed port numbers.
        _ = parsed.port
        origin = f"https://{parsed.netloc}"
    else:
        raise ValueError("API base must be a root-relative path or an HTTPS URL")
    if not re.fullmatch(r"[/a-zA-Z0-9_.~-]*", parsed.path) or ".." in parsed.path.split("/"):
        raise ValueError("Invalid API base path")
    return raw.rstrip("/"), origin


def create_app() -> FastAPI:
    base, origin = api_config(os.environ.get("DOCUMENT_API_BASE_URL", "/api"))
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)

    @app.middleware("http")
    async def private_responses(request, call_next):
        response = await call_next(request)
        response.headers.update({
            "Cache-Control": "no-store",
            "Referrer-Policy": "no-referrer",
            "X-Content-Type-Options": "nosniff",
            "X-Frame-Options": "DENY",
            "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
            "Content-Security-Policy": (
                "default-src 'none'; script-src 'self'; style-src 'self'; "
                f"connect-src 'self'{(' ' + origin) if origin else ''}; "
                "img-src 'self' blob:; font-src 'self'; base-uri 'none'; "
                "form-action 'none'; frame-ancestors 'none'; object-src 'none'"
            ),
        })
        return response

    @app.get("/healthz")
    async def health():
        return {"status": "ok", "service": "document-console"}

    @app.get("/config")
    async def config():
        return {"apiBaseUrl": base}

    @app.get("/")
    async def index():
        return FileResponse(STATIC / "index.html")

    app.mount("/static", StaticFiles(directory=STATIC), name="static")
    return app

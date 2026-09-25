FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 DOCUMENT_API_BASE_URL=/api
WORKDIR /app
COPY requirements.lock ./
RUN pip install --no-cache-dir -r requirements.lock
COPY pyproject.toml README.md ./
COPY console ./console
RUN pip install --no-cache-dir --no-deps . && useradd --uid 10001 --no-create-home console
USER 10001:10001
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/healthz', timeout=2)"
CMD ["uvicorn", "console.app:create_app", "--factory", "--host", "0.0.0.0", "--port", "8080", "--no-access-log", "--no-proxy-headers"]

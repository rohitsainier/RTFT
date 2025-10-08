# PRODUCTION.md

Comprehensive production readiness and deployment guide for RTFT.

## 1) Production Readiness Checklist
- Security hardening completed (HTTPS enforced, HSTS, TLS 1.2+).
- Secrets managed via environment variables or secret manager; no secrets in repo/images.
- Docker images pinned, minimal base, non-root user, SBOM generated.
- Liveness/readiness/health endpoints implemented and documented.
- Centralized structured logging with correlation IDs; log rotation configured.
- Metrics exposed (Prometheus/OpenTelemetry); alerts configured for SLOs.
- Database migrations automated and idempotent; backups and PITR verified.
- External services (TURN/STUN, SMTP, object store) configured and reachability tested.
- Rate limiting, request timeouts, and circuit breakers configured.
- Resource limits/requests set (CPU/memory); autoscaling rules defined if on K8s.
- Observability dashboards (logs/metrics/traces) available and linked.
- Disaster recovery runbook written; restore tested from backups.
- Incident response contacts and on-call rota defined.
- Compliance checks (GDPR/PII, data retention, access controls) reviewed.

## 2) Environment Variables
Set these via .env or your orchestrator secret store.

- NODE_ENV: production
- PORT: Public HTTP port (e.g., 8080)
- HOST: Bind address (default 0.0.0.0)
- LOG_LEVEL: info | warn | error | debug
- LOG_FORMAT: json | text
- REQUEST_TIMEOUT_MS: default request timeout
- CORS_ORIGINS: comma-separated allowed origins
- RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX
- TRUST_PROXY: true if behind reverse proxy

Database
- DATABASE_URL: connection string
- DB_MAX_POOL: max pool size
- DB_SSL: true if server requires SSL

Auth/Secrets
- SESSION_SECRET: cryptographically strong secret
- JWT_SECRET or JWKS_URL: choose one
- API_KEYS_*: any third-party API keys

WebRTC/TURN/STUN
- STUN_SERVERS: comma-separated stun:host:port
- TURN_SERVERS: comma-separated turn(s):user:pass@host:port?transport=udp|tcp
- TURN_API_KEY / TURN_STATIC_CREDENTIALS: if using dynamic credentials
- ICE_TRANSPORT_POLICY: all | relay

Networking
- EXTERNAL_URL: public base URL (https://example.com)
- BEHIND_PROXY: true|false
- HSTS_MAX_AGE: e.g., 31536000

Email/Notifications (optional)
- SMTP_URL or SMTP_HOST/PORT/USER/PASS
- EMAIL_FROM

Object Storage (optional)
- S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY

## 3) .env Management
- Create .env for local/dev only. Never commit .env to git.
- For production, store variables in a secret manager (AWS SSM/Secrets Manager, GCP Secret Manager, Vault, K8s Secrets) and inject at runtime.
- Rotate secrets regularly; prefer short-lived credentials.

## 4) Docker Deployment

Dockerfile best practices
- Use minimal base (e.g., node:18-alpine) or distroless.
- Run as non-root user; set USER in final stage.
- Multi-stage builds to keep image small.
- Copy only required artifacts; use .dockerignore.
- Expose PORT and set NODE_ENV=production.
- Healthcheck CMD to hit /healthz.

Example docker-compose.yml (production-ish skeleton)

version: "3.9"
services:
  rtft:
    image: ghcr.io/rohitsainier/rtft:latest
    env_file: .env
    environment:
      - NODE_ENV=production
    ports:
      - "8080:8080"  # behind reverse proxy for HTTPS
    restart: always
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "5"
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8080/healthz"]
      interval: 30s
      timeout: 5s
      retries: 3
    deploy:
      resources:
        limits:
          cpus: "1.0"
          memory: 512M
        reservations:
          cpus: "0.25"
          memory: 256M

## 5) HTTPS and Reverse Proxy
- Terminate TLS at a reverse proxy (nginx, Caddy, Traefik) or use a managed LB.
- Enforce HTTPS redirects; set HSTS header: Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
- Forward headers: X-Forwarded-For, X-Forwarded-Proto; set TRUST_PROXY=true in app when behind proxy.
- Use Let’s Encrypt or managed certificates; automate renewals.

Example nginx snippet

server {
  listen 80;
  server_name example.com;
  return 301 https://$host$request_uri;
}
server {
  listen 443 ssl http2;
  server_name example.com;
  ssl_certificate /etc/letsencrypt/live/example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/example.com/privkey.pem;
  add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;
  location / {
    proxy_pass http://rtft:8080;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 60s;
  }
  location /healthz { proxy_pass http://rtft:8080/healthz; }
}

## 6) Logging and Observability
- Log format: JSON with fields: timestamp, level, msg, request_id, user_id, path, latency_ms.
- Correlate: propagate X-Request-ID (generate if missing).
- Ship logs to ELK, Loki, or cloud logging; use retention policies.
- Metrics: expose /metrics (Prometheus) with request counts, latency, errors, DB metrics, WebRTC stats.
- Tracing: OpenTelemetry SDK; export to Tempo/Jaeger/Cloud Trace. Propagate W3C trace context.
- Dashboards: provide Grafana/Cloud dashboards for golden signals.

## 7) TURN/STUN Configuration (WebRTC)
- Use at least one STUN server for NAT discovery (e.g., stun:stun.l.google.com:19302) in non-critical envs.
- For production, provision TURN for relaying when peer-to-peer fails.
- Highly available TURN cluster (e.g., coturn) behind DNS with multiple nodes and both UDP/TCP/TLS.
- Credentials
  - Static: username/password distributed via server.
  - Dynamic: Time-limited TURN credentials (REST API to coturn with shared secret) recommended.
- Example ICE servers env
  - STUN_SERVERS=stun:stun1.l.google.com:19302,stun:global.stun.twilio.com:3478
  - TURN_SERVERS=turns:turnuser:turnpass@turn.example.com:5349?transport=tcp,turn:turnuser:turnpass@turn.example.com:3478?transport=udp
- Validate connectivity: periodic TURN reachability checks; alert on excessive relay rate or failures.

## 8) Deployment Steps
- Build: container image with pinned digest; sign image (cosign).
- Scan: run SAST, dependency scan, and image vulnerability scan in CI.
- Migrate: apply DB migrations before starting new version.
- Rollout: blue/green or rolling deploy; keep previous version for quick rollback.
- Smoke test: run basic API and WebRTC handshake checks post-deploy.
- Verify: dashboards green, error rate stable, SLOs met.
- Announce: change log and on-call notified.

## 9) Operational Runbooks
- Incident: how to capture context, severity, comms channels, and mitigation steps.
- Rollback: command or orchestrator action; confirm data compatibility.
- Backup/Restore: frequency, retention, test restore procedure.
- Certificate renewal: automation and failure handling.
- TURN outage: failover plan and temporary config adjustments.

## 10) Scaling Tips
- Horizontal first: stateless app, sticky sessions off unless required; use shared stores.
- Enable autoscaling based on CPU, RPS, p95 latency, and TURN relay bandwidth.
- Database: read replicas, connection pooling, and query optimization; cache hot paths.
- WebRTC: monitor relay ratio; add TURN capacity and bandwidth as usage grows.
- Use CDN for static assets; enable compression and HTTP/2/3.
- Async workloads: queue + worker pools for heavy/long tasks.

## 11) Security & Compliance
- Content Security Policy (CSP) and trusted origins set for WebRTC.
- Input validation and output encoding; enable rate limiting and WAF if available.
- Regular dependency updates; renovate/dependabot configured.
- Access controls and least privilege IAM for cloud resources.
- Data encryption at rest (DB, object store) and in transit (TLS everywhere).
- Logs scrub PII/secrets; adhere to data retention policies.

## 12) Audit Steps (Pre-release)
- Run full test suite, lint, type checks.
- Verify env var completeness against template; fail startup on missing required vars.
- Confirm health endpoints reachable through proxy and LB.
- Run load tests to target peak + headroom; review resource graphs.
- Pen-test or security review completed; fix critical/high findings.
- Chaos test basic failure modes (DB down, TURN unreachable, node kill) and validate recovery.

## 13) Appendix
- Example .env.template (do not commit secrets):

NODE_ENV=production
PORT=8080
LOG_LEVEL=info
EXTERNAL_URL=https://example.com
TRUST_PROXY=true
DATABASE_URL=postgres://user:pass@db:5432/rtft
STUN_SERVERS=stun:stun1.l.google.com:19302
TURN_SERVERS=turns:turnuser:turnpass@turn.example.com:5349?transport=tcp
REQUEST_TIMEOUT_MS=15000
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX=1000

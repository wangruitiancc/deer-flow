# Password recovery

Email password recovery is an optional Gateway feature. It remains disabled
unless all of these deployment settings are present:

- `AUTH_PASSWORD_RESET_SMTP_HOST`
- `AUTH_PASSWORD_RESET_FROM_EMAIL`
- `AUTH_PASSWORD_RESET_PUBLIC_BASE_URL`
- `AUTH_PASSWORD_RESET_ENCRYPTION_KEY` — an independent Fernet key used to
  encrypt queued reset tokens in the auth database.

The public base URL must use HTTPS, except for loopback development URLs. It is
configured by the operator and is never derived from the request `Host` header.
SMTP uses certificate-verified STARTTLS by default. Set
`AUTH_PASSWORD_RESET_SMTP_SECURITY=ssl` for implicit TLS, with an optional
`AUTH_PASSWORD_RESET_SMTP_PORT` override. SMTP credentials are optional as a
pair; configure both username and password or neither. Generate and protect
the encryption key separately from `AUTH_JWT_SECRET`, for example with
`python -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())'`.

The login page displays **Forgot password?** only when
`GET /api/v1/auth/password-reset/status` reports `enabled: true`. Requests to
`POST /api/v1/auth/password-reset/request` return the same `202` response for
unknown addresses, OAuth-only accounts, throttled requests, and eligible local
accounts. This avoids disclosing account existence. The shared auth database
atomically limits each address to three requests and each source IP to five
requests per 15 minutes across Gateway workers. It stores only keyed digests
for those buckets and fails closed if the limiter store is unavailable. The
limit uses `X-Real-IP` only when the TCP peer is listed in
`AUTH_TRUSTED_PROXIES`; `X-Forwarded-For` is ignored. Configure Nginx or the
outer ingress rate limit separately to add an edge-level limit for both
request and completion endpoints.

Eligible requests are written to the shared auth database before the endpoint
returns. Gateway workers claim each row atomically, so queued work survives a
restart and parallel workers cannot send the same queued row. The token is
encrypted at rest and bound to the user, current token version, reset purpose,
and 20-minute expiry. Successful, expired, stale, disabled, and terminally
failed rows are erased. Only an explicit SMTP 4xx rejection receives at most
two retries after the first attempt. A disconnect or other ambiguous result,
including a worker crash during SMTP DATA, is erased without automatic resend.
Invitation and W12 notification mail remain independently disabled unless
their own delivery is configured.

Links carry a 20-minute signed token in the URL fragment. The fragment is not
sent in HTTP requests or Referer headers; the frontend removes it from browser
history immediately and submits the token in the JSON request body. Tokens have
a reset-only audience and purpose. The database atomically advances the user's
`token_version` while setting the password, so replay and simultaneous
redemptions cannot both succeed. A successful reset invalidates all existing
sessions and does not sign the user in automatically. OAuth-only accounts
cannot use local password recovery.

API behavior:

- `GET /api/v1/auth/password-reset/status` — public, `Cache-Control: no-store`.
- `POST /api/v1/auth/password-reset/request` — public and same-origin checked;
  accepts `{ "email": "..." }`, returns a generic `202` response.
- `POST /api/v1/auth/password-reset/complete` — public and same-origin checked;
  accepts `{ "token": "...", "new_password": "..." }`, with no-store and
  no-referrer response headers on success and invalid/expired-token responses.

The default two-server candidate does not configure SMTP, so it leaves the
feature disabled. Tests use in-process transport doubles and a TLS SMTP server
bound to an ephemeral loopback port. The loopback protocol matrix covers
acceptance, temporary and permanent SMTP rejection, an untrusted certificate,
and disconnects before and after message data; it never sends email outside
the test process.

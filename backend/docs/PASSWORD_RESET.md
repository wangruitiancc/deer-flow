# Password recovery

Email password recovery is an optional Gateway feature. It remains disabled
unless all of these deployment settings are present:

- `AUTH_PASSWORD_RESET_SMTP_HOST`
- `AUTH_PASSWORD_RESET_FROM_EMAIL`
- `AUTH_PASSWORD_RESET_PUBLIC_BASE_URL`

The public base URL must use HTTPS, except for loopback development URLs. It is
configured by the operator and is never derived from the request `Host` header.
SMTP uses certificate-verified STARTTLS by default. Set
`AUTH_PASSWORD_RESET_SMTP_SECURITY=ssl` for implicit TLS, with an optional
`AUTH_PASSWORD_RESET_SMTP_PORT` override. SMTP credentials are optional as a
pair; configure both username and password or neither.

The login page displays **Forgot password?** only when
`GET /api/v1/auth/password-reset/status` reports `enabled: true`. Requests to
`POST /api/v1/auth/password-reset/request` return the same `202` response for
unknown addresses, OAuth-only accounts, throttled requests, and eligible local
accounts. This avoids disclosing account existence. Each address is limited to
three requests and each source IP to five requests per 15 minutes per Gateway
process. Multi-worker production deployments must add a shared ingress rate
limit for both request and completion endpoints.

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
feature disabled. Tests use an in-process fake SMTP transport and do not send
email.

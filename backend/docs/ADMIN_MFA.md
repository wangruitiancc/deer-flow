# Local administrator MFA

The optional Gateway MFA flow protects password-based local accounts whose
`system_role` is `admin`. Set `AUTH_MFA_REQUIRED_FOR_ADMINS=1` to require
enrollment and a second factor after password verification. The password step
then issues only a ten-minute, HttpOnly `mfa_challenge` cookie; it does not
issue an authenticated session.

An already-enrolled local account must still complete MFA after a system-role
reduction or when mandatory administrator enrollment is disabled. Only local
administrators may start a new enrollment. Existing one-use TOTP/recovery
checks and token-version fences remain in effect.

On first login, an administrator enrolls a TOTP authenticator. The setup page
shows a secret and ten one-time recovery codes. Save the codes in a secure
offline location before confirming enrollment. Later logins accept a six-digit
TOTP code or an unused recovery code. TOTP steps and recovery codes are
consumed atomically to prevent replay. The challenge cookie is purpose-bound,
short-lived, and single-use.

## Encryption key

`AUTH_MFA_ENCRYPTION_KEY` must contain exactly 64 hexadecimal characters,
representing 32 random bytes. The Gateway encrypts TOTP seeds with AES-256-GCM;
only recovery-code SHA-256 digests are stored. Every Gateway worker using the
same tenant database must receive the same key from the deployment's secret
store. Do not put it in source control, image layers, logs, exported tenant
snapshots, or release inventories.

The local two-server candidate generates this value in the ignored,
permission-restricted `deploy/two-server/.runtime` file. Production must
provision it from the tenant host's secret store. Back it up and rotate it only
with a tested re-encryption procedure: losing or changing the key makes saved
TOTP seeds unreadable and blocks those administrators from completing MFA.

## Scope and rollout limits

This setting covers local password login in the DeerFlow tenant Gateway. It
does not enforce MFA for OIDC/federated administrators; their identity provider
must require MFA and provide an audited recovery path. It also does not cover
the separate Matrix capability-platform operator console. Do not claim
organization-wide administrator MFA from this Gateway setting alone.

There is no self-service MFA reset after all recovery codes are lost, and no
supported audited break-glass reset command yet. Before production rollout,
define and rehearse identity verification, dual control, administrator
recovery, key backup/rotation, and audit evidence. Keep at least two enrolled
administrators and retain recovery codes outside the tenant database. Password
reset does not disable or replace MFA. The current abuse throttle is
process-local; production multi-worker deployments also need a shared edge
rate limit for password and MFA attempts.

The local candidate enables this setting for deployment-path verification.
That proves only the candidate tenant Gateway flow; it does not establish
production secret management or cover the capability-platform admin plane.

## Explicit bootstrap owner transition

A signed Matrix Law owner-bootstrap request normally creates a regular user.
An existing local system administrator is refused unless the operator sets
`MATRIX_LAW_BOOTSTRAP_OWNER_TRANSITION_EMAIL` to that exact email and another
system administrator remains. The normal password proof and atomic repository
comparison of user ID, role, password hash and token version are mandatory.
The transition preserves the existing identity, password and MFA enrollment,
increments token version and clears the old challenge. It does not grant a
firm membership by itself; the signed extension bootstrap owns that transaction.
Remove the one-time operator setting after successful activation.

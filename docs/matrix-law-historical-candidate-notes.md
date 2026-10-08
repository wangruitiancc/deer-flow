# Historical Matrix Law candidate notes

The following text is historical audit evidence. Current deployment authority is the sibling Matrix Law repository deploy/two-server directory; Docker is for local simulation only.

Matrix-Law's isolated 2035 candidate now uses the paired `legal-authorities-import-v1`
Gateway/frontend images and `DEERFLOW_WRITE_FILE_MAX_BYTES=16777216` (bounded 16 MiB,
also affecting ordinary write_file; legal templates retain 64 KiB). Exact hashes, backup,
restore and acceptance status are in the sibling project's authorities deployment record.
Law ingress uses `docker/matrix-law-project-artifacts/nginx.conf`, derived and parity-tested
against the unchanged shared config; only evidence/artifact submission bodies allow 51 MiB.
Existing-stack updates use no-deps and the validated nginx container ID, never compose start
that could execute stale migration dependencies. Main 2030 remains stopped and unchanged;
deployment is not real-model or production acceptance.

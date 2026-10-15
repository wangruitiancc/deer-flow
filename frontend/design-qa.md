# Matrix Law UI v1 — first integration QA

Date: 2026-10-15. Scope: functional workspace shell, speech views, slate-blue palette and persistent navigation. This is a local synthetic-service check of the real frontend, not cloud deployment or full W11 acceptance.

## Source and comparison

- Approved three-column visual: paired repository `docs/design/assets/lawyer-workspace-refined-light.png`; tokens: `docs/design/lawyer-workbench-ui-standard-v1.md`.
- User's latest Codex rail reference: `/var/folders/1l/8h6qxk3x7ndbmytvv3pgylww0000gn/T/codex-clipboard-4182de80-b11b-49f7-887b-0c54c4646b08.png` (916×2738 physical image). This is a navigation-structure reference; its desktop chrome, project names and unavailable product features are not app requirements.
- Implementation: `http://127.0.0.1:4320/workspace/chats/50000000-0000-4000-8000-000000000031`.
- Evidence in paired repository: `docs/design/assets/lawyer-workspace-integrated-speech-slate.jpg` and `lawyer-workspace-integrated-collapsed.jpg`, each1586×992 pixels, captured at1586×992 CSS px (1:1 normalization).
- Approved full layout is1586×992. Reference, rail reference and full implementation were opened in the same image-comparison input. Compared header baseline, rail/tree distinction, retained central conversation, right tabs, compact controls and bottom actions. The PDF source reference and speech implementation show different functional content: document pages are not being judged against a transcript. The shared shell and latest rail requirement are the comparison scope.
- Focused rail comparison: permanent toggle and avatar retained when the matter tree disappears. Desktop capture plus390px drawer interaction confirm the controls remain reachable. This is a functional adaptation of the reference, not a claim of pixel-identical Codex replication.

## Findings and iterations

1. P1: the original collapse control disappeared with its own navigation. Replaced the hover-only header control with a permanently visible toggle in an independent48px rail;216px case tree collapses separately. Post-fix evidence: `lawyer-workspace-integrated-collapsed.jpg`; browser click reopens the tree. Unit tests cover collapsed/open/collapsed and role-gated links.
2. P2: user rejected green emphasis. Shared primary, accent, ring, selection and dark equivalents changed to slate blue; portalled menus/settings receive the same scope. Post-fix evidence: speech screenshot and account menu browser inspection.
3. P1: local overview crashed on missing statistics in the HTTP fixture. Fixture contract repaired; production component now presents a retry alert for malformed statistics instead of crashing or showing fake zeros. Two regression tests pass. Browser overview restored.
4. P2: extracting navigation left no close control inside the mobile modal. Added an explicit mobile close button and shared theme wrapper inside the portal.390×844 drawer opens and closes;800px workspace overlay closes to the underlying navigation.

No remaining actionable P0/P1/P2 within this first-integration scope. Existing OCR/graph/native-editor internals are reused; their complete visual redesign is a separate remaining batch, not covered by this pass.

## Interaction and technical verification

- Four function tabs, function add/opened menus and keyboard close/focus behavior; mounted state retained across function switches/close.
- Speech records, selected fixed version, read/edit, source warnings, protected synthetic80s audio and fixed review/player controls. Dirty draft retention and new-version conflicts covered by DOM tests.
- Saved graph source integrity and rendering; fixed project-note version opens in native read-only reader.
- Desktop collapse/reopen, collapsed avatar menu, role-gated management link and settings; mobile drawer close.
- Appearance manual light/dark, system and solar city selector. No geolocation requested.
-48 files /397 affected Rstest tests passed; frontend ESLint+TypeScript check passed; Next production build passed. Tests are synthetic. No backend write/model/microphone or cloud acceptance in this run.
- Existing browser error log retains earlier fixture403, overview errors and hot-reload diagnostics. The later navigation/speech/graph/note inspection produced no new error. Do not describe historical logs as empty.

## Open questions / remaining validation

- Real isolated API writes, live capture with hidden workspace, revocation and production deployment need their existing acceptance workflows. Local fixture rejects writes403 and has no authentication or model.
- Native OCR, graph and document editor inner layouts retain their existing behavior; incremental styling must keep source/review/export gates.
- Full screen-reader/200% zoom acceptance and all target browser paths are not claimed.

## Follow-up polish

- Align secondary reader metadata and table typography incrementally under the shared tokens without replacing native version/source controls.

## Lifecycle follow-up in the same integration

- The return action now reopens the speech function, even if that function was closed while another function was selected.
- Completion preserves a file-upload view and an active dirty transcript editor. Both regressions failed before the callback guard and pass afterward.
- Speaker/tail edits clear review confirmations; trailing text in read mode is plain text. Version conflicts require an explicit new baseline.
- Query freshness uses the successful-read timestamp, warns for stale/paused/error reads, and offers manual refresh. `lawyer-workspace-integrated-query-freshness.jpg` is the local synthetic914×1164 viewport evidence.
- Real speech/evidence HTTP routes were additionally exercised against disposable PostgreSQL/MinIO/ClamAV, with synthetic identity/chat context and a model substitute. Chromium recorded; Firefox/WebKit failed closed. This is not target authentication or real ASR evidence.
- The separate Chromium mock capture matrix passes4 cases, including real IndexedDB, quotas/corruption, late permission cleanup and identity/logout. These are not real-service requests.
- Root paired repository records the worker idle-admission fix and full1041-pass/9-skip extension run. That change is not deployed. T44 and the signed target rollout remain open for the overall W11 goal.

## Route ownership and performance follow-up

- Shared theme/reset/component rules were moved byte-for-byte from the old global body into `styles/theme.css`. Auth/admin/workspace utility sources now belong to their route layouts. Standalone layouts keep compatibility styles; page/source coverage and transitive AI imports are checked.
- Protected Markdown keeps renderer/highlighter utility sources, headings, tables, task lists, equations and code. Its existing sanitizer rejects arbitrary authored utility classes, so workspace no longer compiles the old broad generic page safelist. Standalone routes retain that compatibility safelist.
- Login/recovery retain the same validators and role routing. Complete type erasure prevents shell-only imports executing the schema; public string helpers inline existing values while `env.js` and Next configuration keep full env validation. A retired probe cannot apply a late identity.
- Overview/hold/work-product panels, command dialogs and source editor code load on use. Keyboard listeners remain mounted and menu loading stays closable. The actual command menu opened from the composer during browser QA.
- Final affected regression:71 files /556 tests passed, no skips. Frontend ESLint+TypeScript check passed. Both production build modes complete inside the isolated measurement snapshot; all unchanged numeric route byte budgets pass. The disabled docs/blog routes now have strict307-to-workspace contracts; a served page/wrong destination fails, with no fake zero-byte asset report.
- Local measured JS/CSS bytes: login801688/91153; admin home961843/89095; legal overview1736589/179246; fixed demo chat3756179/179246. These are unique HTML-referenced raw asset bytes, not Web Vitals, compressed network totals or all later feature chunks.
- Browser QA checked default1280×720 light/dark speech reader, footer/player and settings. A1586×992 light capture was compared with `lawyer-workspace-integrated-speech-slate.jpg`: rail/tree, chat and right pane align; text sizing and fixed control rows remain consistent. Expected freshness text/manual refresh additions are retained. Shared theme body is unchanged. Temporary viewport and theme changes were restored to default and solar/Shanghai.
- Evidence lives in the paired Matrix Law repository under `docs/design/assets/lawyer-workspace-performance-*.jpg` and the W11 performance record. The UI fixture is read-only synthetic data with microphone disabled; this visual check is not a target login/model/microphone test. T44 and target rollout still remain open.

final result: passed

## W11 preview visibility and recognized duration — 2026-10-15

Preview output now uses a bounded scrolling list with follow-latest behavior.
Scrolling upward retains the reader's position; “回到最新” resumes following.
A new capture resets that preference and a closed/inert workspace cannot be
revealed. Computed silence and missing results have separate labels. Recognized
duration sums computed windows after revision merging, excluding gaps/nulls.

The numeric-only timing probe now requires each computed-result time label to
be fully inside the viewport and ancestor overflow clips. Hidden/inert/offscreen
labels cannot satisfy display timing; scroll/resize can trigger rechecks. This
keeps the original cold-window, all-window, minimum-20 and P95<=5000ms gates.

Validation: 29 targeted unit/DOM/style tests passed, no skips; full ESLint and
TypeScript check passed; the real Chromium Worklet clock self-test passed (1).
The browser test uses a synthetic oscillator and controlled display delay, not
real ASR. These checks do not close target-machine T44 or authorize claims about
legal-material recognition quality. No cloud app activation in this change.

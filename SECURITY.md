# Security and data boundaries

Report a security issue privately through the maintainer's GitHub profile contact options. Do not include credentials or private Bug content in public issues.

## Connections

Configure your own ZenTao root origin. The public package has no default company endpoint or account. The Host verifies the current account and user ID before using saved credentials. Redirects and media reads must remain on that configured origin. Root installations using compatible classic ZenTao JSON and web-form routes are supported; subdirectory deployments, customized SSO, captcha login and other API variants are not automatically adapted.

Token mode expects a grant accepted by the site's `/user-login.html?token=…` exchange and verified via `/my-profile.json`. It is not a promise that every ZenTao REST API token can log into the web interface. Cookie mode accepts the user's own authenticated session cookie for a compatible installation. Cookies are credentials: enter them only into the local plugin's password field. The plugin does not scrape your browser's cookies or import another application's credentials. Cookie mode does not turn that cookie into a REST upload token; unsupported media operations fail before upload.

Secrets are saved through the DSH credentials service under a separate, site-bound public-plugin namespace. They are not returned in RPC status or included in the repository, screenshots or package. The security of the credentials service depends on the host; do not assume operating-system Keychain encryption. A process running as the same OS user may have access to its local files.

## Browser storage

Browser local storage and IndexedDB hold Bug draft text, selected media, list snapshots and view position. Data is scoped by configured origin and authenticated account. This is local persistence, not encrypted backup or cross-device sync. Disconnect using the plugin before handing a shared profile to another user. Avoid clearing browser storage before preserving any unsent work.

## Writes and uncertainty

Creating, editing, uploading evidence and closing a Bug require explicit UI confirmation. The Host re-reads authoritative metadata at the write boundary and checks identity and associations. A response without a matching readback is shown as pending. Never retry an uncertain POST: reconcile the existing Bug and history first.

The duplicate-write guard is process-local. After a Host restart, independently check ZenTao before repeating any uncertain operation. The plugin does not run your tests, establish acceptance, synchronize an external ledger or notify developers automatically. Closing a Bug is not evidence that acceptance testing occurred.

## Optional AI

AI assistance is disabled by default. If enabled, configure an explicit DSH provider and model. Clicking AI optimization may send draft text and up to six bounded images to that configured provider. Video is not sent. Review your organization's data policy before enabling it; sensitive screenshots should be redacted before selection. Suggestions require explicit application and submission; they do not authorize a write.

## Public assets

Use synthetic accounts, products, Bug titles and media when contributing fixtures. Keep real project data, authentication files, runtime exports, recordings, third-party account caches and support logs outside public commits. The package validator enforces an explicit runtime allowlist and scans for private-path and credential-like strings.

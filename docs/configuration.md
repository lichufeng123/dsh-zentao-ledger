# Configuration and compatibility

The package is an independent DSH plugin. It contains no organization endpoint, login token, private account, product association or external AI service default.

## Host configuration

Set this entry in the Cordis patch of your active DSH profile. Change every example value to your own authorized site and IDs:

```yaml
- id: dsh-zentao-ledger
  config:
    origin: https://zentao.example
    productId: '3'
    projectId: '9'
    productName: Demo Product
    projectName: Demo Project
    authMode: token
    ai:
      enabled: false
```

`origin` is an HTTPS origin with no username, password, query, fragment or installation subdirectory. The default is empty; a fresh installation does not contact any site. `productId` and `projectId` are required for a configured ledger. Names are optional additional checks: when supplied, the corresponding server metadata must match. New Bugs use that configured association; editing retains the original record's associations. Branch, module and execution use the documented default context for new Bugs.

`allowHttp` defaults to `false`. Set it only for a deliberately authorized HTTP deployment that you understand carries authentication without HTTPS transport protection. It does not authorize redirects to other origins or remove identity checks. Prefer HTTPS.

Changing configuration remounts the plugin according to the DSH host's normal behavior. Credentials are bound to the origin and authentication mode. Browser caches/drafts are bound to the verified site, account and user ID. Switching accounts requires disconnecting and reconnecting; a private local package's credential namespace is not read or migrated automatically.

## Authentication modes

### Compatible grant-token exchange

`authMode: token` expects an authorized grant accepted by the site's `/user-login.html?token=…` web-session exchange. The Host reads `/my-profile.json` and verifies the actual account and user ID before saving the grant through DSH's credentials service. A generic REST API token or an unrelated application's API token is not necessarily accepted by that route.

The grant appears in the Host's login transport URL as required by that contract. It is not returned to the client or deliberately logged. Ensure your own server/proxy logging policy also protects login URLs.

### Existing web session

`authMode: cookie` accepts your own already-authenticated Cookie header in the plugin's password-style field. Obtain it only through your organization's approved process. Never paste cookies into chat, screenshots, shared configuration or issues. The Host verifies the profile and uses only the configured origin. It does not read or export a user's browser cookie database.

This mode does not renew the upstream login. Reconnect with a new authorized session when it expires. It does not convert a cookie into an API token. REST image-upload authorization is unavailable in this mode and is rejected before a media upload request. Compatible web-form text/video operations may still work if permitted by the server.

## Supported contracts and limits

- Classic `/user-bug-…json`, `/bug-view-…json`, `/bug-create-…json` and `/bug-edit-…json` response/form contracts are required. Envelopes containing JSON strings are supported.
- Read-only product requirements use `/api.php/v1/products/{productId}/stories` under the verified session, without sending a Cookie value as a REST Token header. Server support and permissions are still required.
- The selected site's classic JSON field names, version/build metadata and web-form context must match the supported parser. Custom workflows and required custom fields may need a site adapter.
- Root-origin deployments are supported; installations under a prefix such as `/zentao/` are not automatically rewritten.
- There is no account/password login form, CAPTCHA solver, organization SSO implementation or organization CLI renewal integration in the public package.
- Close is per Bug, requires a currently resolved status and explicit confirmation, and validates the supported web form before its single POST. A deployment with an unsupported close form should use the original site instead.
- Searching operates on loaded records. Board counts are partial until all pages are loaded.

## Media and local drafts

The plugin accepts at most six media files, up to 8 MiB per PNG/JPEG/GIF image or 25 MiB per MP4 video, and 40 MiB in total. Server limits may be lower. Image upload uses the site's REST file contract only after a read-only REST identity check; image references and video attachments are checked again on readback.

Expected and actual image groups remain separate, with local ordering and preview. Selecting or pasting a file does not upload it. Automatic text drafts expire after seven days; the multi-draft box stores up to 20 drafts for 30 days. Media uses IndexedDB; when media persistence fails the interface reports that limitation instead of silently discarding work.

## Optional AI description assistance

```yaml
- id: dsh-zentao-ledger
  config:
    origin: https://zentao.example
    productId: '3'
    projectId: '9'
    ai:
      enabled: true
      provider: YOUR_DSH_PROVIDER_ID
      model: YOUR_DSH_MODEL_ID
```

Use provider/model IDs already configured in your DSH host. Both must be set; the plugin has no embedded API key or fixed provider and does not silently fall back to another route. The provider must support images if you include screenshots. Clicking optimization can send the draft and up to six images to that configured model, with a longest side of 1600 pixels, up to 2 MiB per prepared image and 10 MiB in total. Video is not sent.

Review and apply the suggestion explicitly. It does not change the remote Bug or establish a test result. Leave AI disabled when your organization's data policy does not allow that transfer.

## Unknown outcomes and uninstalling

If a write returns an ID but readback is pending, use only the read-only reconciliation for that ID. Without an ID, check the original site by title, owner and time before another write. The duplicate-write lock is local to the current Host process; after a restart do not assume that lock survived.

Disconnect clears this plugin's saved authorization and its local data according to the UI contract. Removing a package by itself is not proof that all host credentials or browser storage have been removed. Preserve any unsent work before disconnecting or clearing browser storage.

See [Security](../SECURITY.md) and [Contributing](../CONTRIBUTING.md). Mock tests verify the implementation's contracts, not compatibility with an untested production instance.

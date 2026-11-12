# Contributing

Fork the repository, make a focused change, and open a pull request describing the user-visible behavior and relevant validation. The MIT license permits maintaining your own version.

```sh
npm ci --ignore-scripts
npm run check
npm test
npm run validate
npm pack --ignore-scripts
```

Use Node.js 22 or later. Tests use synthetic transports and must not contact a real ZenTao instance, read personal credentials, or create a real Bug. New connection variants should include fixtures for identity mismatches, redirects, expired sessions, write rejection and uncertain readback. A mocked success is not a claim that an organization's deployment is compatible.

The frontend uses the React supplied by DSH through `window.__ModuleLoader__`; it is not a standalone application. Keep the client transport inside its service adapter, and do not expose secrets to the rendering layer. AI integration must use the explicitly configured route with no silent provider fallback.

For a bug report, include the plugin/DSH/Node versions, authentication mode and whether the failure was a read or an explicit write. Include only sanitized errors. Remove tokens, cookies, private domains, real Bug content and personal names before posting screenshots or logs. Check existing issues first.

Source code, examples, documentation and reviewed synthetic screenshots are public. Runtime credentials, user drafts, real evidence and generated local release receipts are not. Do not copy your working profile or a private development archive into this repository.

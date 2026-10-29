# React + TypeScript + Vite

## Electron development

Run `npm run dev` to start Vite, compile Electron TypeScript in watch mode, wait for both resources, and open the Electron window.

### Electron security configuration

`COLORFUL_LIFE_BACKEND_URL` defaults to `http://localhost:3000`. Non-loopback endpoints require HTTPS; explicit HTTPS ports and API base paths are supported (for example, `https://api.example.com:8443/api`). HTTP is permitted only for literal `localhost`, `127.0.0.1`, or `[::1]`. Credentials, whitespace, query strings, fragments, unsupported schemes and malformed URLs fail startup without logging the supplied value. Backend redirects are rejected: configure the canonical endpoint directly.

Packaged applications always load their bundled `dist/index.html` and reject `ELECTRON_RENDERER_URL`. Unpackaged development may use a loopback server origin; the standard Vite server runs at `http://127.0.0.1:5173` with a strict port. Runtime checks can also name the exact compiled entry file. The privileged window permits only its entry document and fragment navigation. Other navigation, redirects, subframes and webviews are blocked. Existing allowlisted carrier tracking links open in the system browser.

Every IPC handler checks the current BrowserWindow, WebContents, main-frame identity and renderer document URL before executing. Rejected calls use the structured error envelope with status `403` and Backend code `FORBIDDEN`. Authentication tokens remain in Main Process memory; the renderer receives session views and typed operation results.

Vite injects the CSP into both development and production HTML. Production permits bundled scripts/styles, Cloudinary images (`https://res.cloudinary.com`), and local image previews; renderer network API calls and embedded frames are blocked. Development additionally permits the local Vite HTTP/WebSocket connection and injected styles, with hashes for the React refresh preamble instead of unrestricted inline scripts. These controls follow [Electron's security guidance](https://www.electronjs.org/docs/latest/tutorial/security).

`npm test` runs unit tests, production builds, boundary checks, the existing purchase/order Electron runtimes, and security runtimes for both compiled-file and Vite development renderers. Security runtimes use local HTTP fixtures and intercept Cloudinary requests before network access; they require a graphical Electron environment and port 5173 to be available. They do not contact a real Backend or database.

## Catalogue presentation management

After signing in, the Presentation management panel loads active listings from `GET /products` and uses listing IDs for all presentation actions. The backend `isFeatureProduct` value is the only source of Feature/Standard state. `PATCH /products/:id/feature` is atomic and category-scoped; the Admin refreshes the catalogue after it succeeds. The backend does not expose a Feature-clear operation, so the Admin only offers selecting or changing a Feature listing.

Catalogue artwork is separate from `listingImages`. The Admin sends artwork files through the backend with `PUT /products/:id/catalogue-artwork` and removes them with `DELETE /products/:id/catalogue-artwork`. It displays the backend-returned `catalogueArtworkUrl` directly and keeps `catalogueArtworkPublicId` as storage metadata. The backend enforces JPEG, PNG, or WebP files up to 8 MiB and owns the Cloudinary credentials and storage namespace.

For local upload testing, run the backend with its Issue #92 database migration and Cloudinary configuration, then set `COLORFUL_LIFE_BACKEND_URL` for the Admin. No Cloudinary credentials are needed in this project.

Run `npm run build` to build the renderer into `dist/` and compile the Electron main/preload files into `dist-electron/`. `npm run electron` then loads the built renderer from `dist/index.html`.

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])

```

You can also install [eslint-plugin-react-x](https://npmx.dev/package/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://npmx.dev/package/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])

```

### Inventory Management — Phase 1

Inventory shows listing/product identity, current, reserved and available local stock,
plus recorded movement history. The Backend listing API currently omits a separate
reserved field; Admin derives it from `currentStock - availableStock` and validates
the response. SKU is not supplied by this API; set numbers and listing IDs are shown.
Current stock already excludes confirmed website sales, including orders not yet
dispatched. It is not a physical shelf count. Historical opening balances are not
invented, and Amazon warehouse inventory is not tracked.

The FBA form uses the merged Backend #202 endpoints. Main validates every request,
generates an idempotency key and writes the immutable payload to a Main-only journal
before any POST. Files live under Electron userData `inventory-shipments`, separately
scoped to the Backend URL and authenticated Admin ID; no access/refresh tokens or
credentials are written. Each account may have one outstanding shipment per Backend. Before mutating a journal,
Main claims Electron's native instance lock; another process sharing the profile
cannot write or submit inventory until the owning process exits.

After a timeout, lost response, malformed success or interrupted process, the saved
shipment remains locked and must be retried with its original key, using the same
Admin account. Only the Backend-confirmed post-idempotency responses 409 INSUFFICIENT_AVAILABLE_STOCK,
409 USED_OFFER_NOT_SUPPORTED or 404 LISTING_NOT_FOUND conclusively reject even a
previously uncertain shipment, allowing explicit discard. Other responses (including
400, 401, 403, 5xx and IDEMPOTENCY_CONFLICT) do not resolve prior uncertainty. A Backend
idempotency conflict requires ledger investigation; no automatic new-key fallback
exists. A confirmed result/replay permits an explicit “Start another physical shipment”
action. A conclusively rejected retry, a definitively rejected first request, or an unsent
prepared shipment can be explicitly discarded. Do not delete an uncertain journal or record those goods under
a new key. Unreadable/unwritable journals fail closed and require recovery before new
submissions. Files may contain business shipment notes and should be preserved when
moving an Electron profile to another machine.

Confirmed success/replay refreshes live inventory and movement history. The recorded
outbound result is a historical snapshot, not a substitute for those refreshed reads.
Stocktakes, write-offs, generic adjustments and purchase/checkout changes are excluded.
Backend #202's migration must already be applied to the chosen API environment.

Verification uses mocked IPC/HTTP fixtures only, never the HTTP-only local Backend
launcher for writes. `npm run test:inventory-runtime` exercises the compiled Electron
UI and a disposable HTTP fixture, including a committed shipment with a lost response,
retry across navigation, audit retrieval and exactly one deduction. It is included in
`npm test`; the existing security runtime also verifies the seven new IPC channels.

Shipment journals use same-directory temporary files, file fsync before atomic rename,
and directory fsync where supported. Discard writes a flushed null tombstone instead
of unlinking the journal. Windows may not permit directory handles/fsync; only known
unsupported-operation errors are tolerated there. Other I/O failures fail closed.
These measures improve crash consistency but cannot guarantee durability on every
filesystem, storage device or power-loss scenario. Preserve profiles and investigate
corrupt journals before recording the same goods again.

### Order payment and refund visibility

Order details read the existing ADMIN-only payment and refund history APIs through
`admin-orders:financials`. Main validates identities, currency/decimal amounts and
statuses, and sends only explicitly selected display fields to the renderer.
Amounts arrive in major currency units: `25` GBP displays as £25.00. Refund actors
are shown by their recorded Admin ID; actor names are not provided by this API.

The two reads are separate snapshots. Incomplete, inconsistent or review-required
information must be refreshed/reviewed before dispatch; a failed history read is
never an empty history. Fully refunded payments and funds reserved for pending or
unresolved refunds disable preparation/dispatch locally. Partial refunds alone do
not introduce a new dispatch prohibition. Backend payment/security/inventory
checks remain authoritative, including when financial state changes after a read.
Recorded refund status is displayed separately from uncertainty/review metadata.
This screen cannot execute/reconcile refunds, release holds or change payments.

## Automatic remote Sandbox connection (Windows Electron)

Install AWS CLI v2 and Session Manager Plugin once, and configure the existing
`colorful-life-admin` AWS profile using the AWS CLI credential chain. Admin does
not save access keys or tokens. Administrator account permissions are separate
from tunnel connectivity; a Connected tunnel does not grant administrator access.

From the existing Windows checkout after pulling main:

```powershell
npm ci
npm run build
npm run electron:sandbox
```

For development with hot reload, use `npm run dev:sandbox`. Both commands select
`remote-sandbox` mode and automatically establish the tunnel, without a separate
PowerShell window or manual SSM command. For a packaged executable, set the user
environment variable `COLORFUL_LIFE_CONNECTION_MODE=remote-sandbox` once before
launching it. Ordinary `npm run dev` / `npm run electron` retain direct/local mode.

Configuration uses the existing process environment convention:

| Variable | Remote Sandbox default |
| --- | --- |
| `COLORFUL_LIFE_CONNECTION_MODE` | `direct`; explicitly select `remote-sandbox` |
| `COLORFUL_LIFE_BACKEND_URL` | `http://localhost:3000` (derived from local port if unset) |
| `COLORFUL_LIFE_AWS_PROFILE` | `colorful-life-admin` |
| `COLORFUL_LIFE_AWS_REGION` | `eu-west-2` |
| `COLORFUL_LIFE_SSM_INSTANCE` | `i-02b28336518077a8f` |
| `COLORFUL_LIFE_SSM_REMOTE_PORT` | `3001` |
| `COLORFUL_LIFE_SSM_LOCAL_PORT` | `3000` |
| `COLORFUL_LIFE_AWS_CLI_PATH` | optional absolute executable path |
| `COLORFUL_LIFE_SSM_PLUGIN_PATH` | optional absolute executable path |

The installed Windows plugin is discovered under
`C:\Program Files\Amazon\SessionManagerPlugin\bin`; its directory is added only
to the spawned process environment. No system PATH edit is required. Remote mode
rejects a Backend URL that does not match the configured loopback port.

Login remains disabled while Connecting. Connected requires the owned plugin's
port-open acknowledgement and successful Backend `/health` and `/ready` responses.
Failure is shown with a Retry Connection button; retries are explicit, not endless.
Refresh expired AWS credentials outside Admin, then retry. If port 3000 is occupied,
close the old manual tunnel yourself or configure another local port. Admin never
adopts or kills an existing listener or unrelated AWS session.

Windows uses a hidden PowerShell Job Object supervisor to contain the directly
spawned AWS CLI and plugin descendants. Closing Admin (or an application crash)
closes the supervisor's job. PowerShell must be permitted to run the bundled
helper; its per-process execution-policy argument does not change system policy.
Failure to establish process ownership blocks connection. The helper is unpacked
alongside packaged application assets, rather than executed inside ASAR.

Windows acceptance checks (no customer/order changes): start in Sandbox mode,
observe Connecting then Connected, confirm login can reach the Backend, close the
app and confirm its tunnel exits. Reopen, interrupt only its own tunnel, and use
Retry Connection. Verify an unrelated manual tunnel is left alone; an occupied
port must produce Connection Failed. A role-denied login is an account issue,
not a tunnel failure. CI validates process ownership with synthetic Windows
processes, without AWS calls, credentials, customer emails or payment operations.

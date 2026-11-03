# Admin UI/UX review — November 2026

Scope: dashboard and navigation; orders and order details; fulfilment and
shipment; returns; refunds (Refund V2); inventory; operator workflows; forms,
dialogs and error states. The review was made for a single operator running the
whole business. It covers the current `main` (fa8cc77) plus this branch.

Severity: **P0** functional or financial safety · **P1** major workflow ·
**P2** consistency and accessibility · **P3** cosmetic.

## Findings and changes made

| # | Sev | Finding | Change |
|---|-----|---------|--------|
| 1 | P0 | The Confirm Shipment cost field was `type="number"`. Chromium silently drops a typed comma, so `3,99` was recorded as **£399.00**. | Text field with a decimal keypad, parsed to exact integer pence. A comma is rejected with an explanation. The modal shows "Will be recorded as £3.99." |
| 2 | P0 | A shipping cost of any size up to £100,000 was confirmed without a second look. | Costs above £15.00 (1500 pence) need explicit approval, bound to that exact amount. Cancel and Escape never confirm the shipment. |
| 3 | P0 | Stacked modals in Chromium share one Escape (close-watcher grouping). An Escape on a second modal also closed the form underneath. Found while building #2. | The approval is a step inside the shipment dialog. `onClose` keeps React state in step with the real dialog. |
| 4 | P1 | There was no way to record delivery, so orders stayed "Dispatched" for ever. | **Mark as Delivered** for dispatched shipments. The confirmation names the manual carrier-website check and records the operator and time. Duplicates are rejected by the Backend. |
| 5 | P1 | Fulfilment actions sat at the very bottom of the order page, below products, address, history and the whole Operator workflows panel. | A **Next step** panel directly under the summary says what to do now and holds the actions. |
| 6 | P1 | Disabled Preparing and Shipment buttons gave no reason when a payment warning blocked them. | Next step states that shipping is blocked and where the warning is. |
| 7 | P1 | Navigation was eight equal buttons, ordered by build history rather than daily use. | Grouped into Daily operations (Orders, Returns, Operator workflows), Catalogue and Stock, with daily operations first. |
| 8 | P2 | The active section was shown by colour only. | `aria-current="page"` on the active section. |
| 9 | P2 | Fixed 120px nav buttons cramped "Operator workflows". | Buttons size to their labels. |
| 10 | P2 | "View Returns" was a primary button competing with fulfilment actions. | Secondary button, inside Next step. |
| 11 | P2 | Fulfilment stage was plain text. | Colour-coded status pill (to do, active, done). |

Each change has unit, UI and compiled-Electron regression tests.

## Deferred recommendations

| # | Sev | Recommendation | Why deferred |
|---|-----|----------------|--------------|
| D1 | P1 | Open the Admin on **Orders** rather than Products. | It changes the owner's habit; needs your approval. It is a one-line change. |
| D2 | P1 | An Orders list filter for "needs action" (paid and not dispatched; dispatched and not delivered). | The Backend list endpoint only supports paging. This needs a reviewed query parameter. |
| D3 | P1 | Record the over-£15 approval in a server-side audit history and enforce the threshold in the Backend. | This branch enforces it in the Admin only. Needs your decision; it fits the same no-migration `OperationalAudit` pattern used for delivery. |
| D4 | P2 | Replace native `window.confirm` (catalogue artwork, product images, purchase receipt) with the in-app dialog pattern. | Seven call sites in catalogue and purchase flows, outside this change's scope. |
| D5 | P2 | Give the Operator workflows panel buttons the shared `button` styles; they currently render as unstyled native buttons. | That panel drives paid-cancellation and refund intents. Left untouched so Refund V2 behaviour and tests stay exactly as reviewed. |
| D6 | P3 | Show friendly labels for raw enum values in Payment and refunds (`SUCCEEDED`, `STRIPE`). | Cosmetic. The component's exact-text financial tests would need review. |
| D7 | P3 | Use a consistent success style for status messages; they are plain text today. | Cosmetic. |

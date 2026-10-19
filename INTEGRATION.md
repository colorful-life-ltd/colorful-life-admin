# Coordinated integration — Backend issue #211

This branch implements the Admin side of the [single three-system master issue](https://github.com/colorful-life-ltd/colorful-life-backend/issues/211), based on the full independent audit in Backend PR #210. The canonical acceptance map and release gates are in Backend `docs/integration/211-three-system-handoff.md`.

Operator workflows are available in the main navigation and beside order/inventory detail. All requests cross validated, allowlisted Electron IPC; credentials remain in the main process. Use the recorded Payment ID for chosen refunds. Paid cancellation is staged: request intent, refund explicitly, then cancel/restock after full finality. Withdrawal requires the exact active requestId; a version conflict requires fresh audit, not a replacement request. Every successful order action refreshes audit, current eligibility and detail.

Inventory stock corrections use reasoned physical stocktake. Write-offs and stocktakes use durable Backend idempotency receipts. Packaging-damage conversion uses one physical NEW unit and 1–3 real condition photos, preserving the Used-offer history model. Open FBA discrepancies show actual/applied/shortfall; saved shipment uncertainty is recovered only with its original key and payload. Never discard uncertain requests or replay non-idempotent endpoints blindly.

Availability is a manual business decision. Discontinued requires definitive confirmation that a product will never be restocked or sold again; More on the Way requires genuine restock expectation. The Backend requires an active ADMIN, explicit evidence/reason and an immutable policy audit; Discontinued also requires permanentDiscontinuationConfirmed=true and More on the Way requires restockExpectationConfirmed=true. Unknown restock status remains Sold Out. Neither policy enables backorders. Manufacturer Retired Set metadata is separate. Unpublication/discontinuation preserves previously public detail URLs and existing orders.

## Validation and packaging

Unit tests, no-emit typechecks and lint can run without starting the desktop application. Builds and Electron/runtime execution require the owner's explicit approval. CI includes these gates and must not be triggered until that approval is granted for this change.

After approval: `npm ci`, `npm run build`, boundary/runtime checks (use a display or `xvfb-run`), `npm run package`, then `npm run verify:package`. Packaging produces an unsigned bundle for the host platform; it is not a signed installer or auto-update service. macOS signing/notarization, Windows signing and installed-platform acceptance require owner-controlled release infrastructure. Set `COLORFUL_LIFE_BACKEND_URL` to the approved HTTPS API endpoint when launching the distributed application. The staging list includes only built renderer/main/preload assets, not source, environment files, secrets, contracts or local journals.

The shared fixture is pinned through `contracts/backend-ref.txt`; `npm run test:contracts` checks it against the canonical immutable Backend commit. During local unpushed development set `BACKEND_CONTRACT_FILE` to the integration worktree's canonical JSON. Never change fixture expectations to conceal a parser mismatch.

The owner approved the execution gate on 2026-10-19. Local production builds, boundary and all five Electron fixture harnesses, and the unsigned Linux x64 bundle/archive checks have passed. The expanded order harness verifies compiled cancellation/withdrawal and exact-key lost-response recovery. Final full-suite/CI totals and PR links are recorded in Master Issue #211. No production readiness claim is made before independent review.

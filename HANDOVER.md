# Phase 2 handover

## Current state

- Product: Medicine Inventory Tracker, household-first responsive web app. Future iOS/Android clients and general store inventory are long-term goals.
- Repository: https://github.com/sudoku0412-stack/medicine-inventory-tracker (public), main branch.
- Phase 1 implemented and pushed: implementation commit 1606a91, merge commit eb2e5c2. User approved the design and accepted Phase 1 with the UI defect below deferred to Phase 2.
- Stack: plain HTML/CSS/JavaScript, Node 26+ HTTP API, built-in SQLite. No third-party runtime dependencies. Run npm start; open http://127.0.0.1:3000. Run npm test (five tests passed at handover).
- Local data: data/inventory.sqlite, excluded from Git. Do not overwrite user inventory. A discarded test batch may remain from browser verification.

## Delivered behavior and limits

- Manual batch creation/editing, quantity/unit and low-stock threshold, expiry/unknown expiry, location/notes, consume/discard, dashboard, search/status filters, responsive layouts, persistent in-app expiry reminders and read state.
- Expiry and reminder rules use date-only calendar arithmetic with a 30-day warning window. Same medicine may have multiple batches.
- Local single-user application, no authentication. Default bind is 127.0.0.1. Static assets use an explicit allowlist to protect source, Git metadata and database files.
- Notifications are IN-APP ONLY. No email/push delivery or background external notification service is implemented. This remains a gap from the original away-from-app notification requirement; do not describe it as completed external alerting.
- Tests cover persistence, validation/overdraw, edit/discard, date boundaries and reminder deduplication/read/stale cleanup. Manual HTTP and browser checks were performed; comprehensive automated browser and HTTP regression coverage is still missing.

## Phase 2 priorities

1. Fix the blank button in Notifications > Monthly cabinet check. User screenshot shows a white button without visible text; clicking returns home. Reproduce, determine intended label/action, correct contrast/accessibility and navigation. User explicitly deferred this fix to Phase 2. Do not assume a root cause without inspection.
2. Previously proposed Phase 2: take/upload packaging photos, suggest medicine name and expiry with AI, require user confirmation, and prompt manual entry for unreadable/ambiguous values. Manual entry stays available. Provider, credentials, cost controls, image retention and date handling still need decisions before implementation.
3. Discuss a real expiry notification delivery channel (email or web push) and scheduling when the app is closed; no service credentials or deployment target has been selected.

Household sharing and commercial store features remain later phases. Retain an API/batch foundation that future clients can reuse. Preserve the approved UI unless the user requests changes.

## Working agreement

Follow AGENTS.md for the updated models and delegation workflow. User wants the main agent to coordinate and specialists to implement. Senior reviews completed work. Use compact briefs and one consolidated review; escalate after one unsuccessful fix round. Monitor five-hour usage and pause below 15% remaining, notifying once. Last observed remaining usage was 16%; query fresh limits before new work rather than relying on this stale snapshot.

No Phase 2 implementation has started. The next chat should read this file and AGENTS.md, inspect the current repo, check usage, and agree on the Phase 2 scope. Changing the saved Orchestrator preference does not change the current chat model; select GPT-5.6 Terra / Low in the app for routine orchestration.

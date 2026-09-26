# Bugfix plan

## Guiding principles

- Prefer observed behavior and captured evidence over plausible theories.
- Make one narrowly scoped, reversible fix at a time.
- Preserve user data and avoid changing authentication, DNS, or deployment state while diagnosing.
- Every fix ends with a regression test and an independently reviewable checkpoint.

## Triage phases

1. **Identify the production version.** Record the deployed Worker/version, commit or PR, browser/device, and timestamp.
2. **Reproduce.** Write exact steps, expected behavior, actual behavior, frequency, and whether a clean session changes it.
3. **Capture request/response evidence.** Record URLs, status codes, relevant headers, console errors, and response/body differences. Remove secrets and personal data.
4. **Compare deployed vs source.** Inspect the deployed asset/API and the corresponding source, including generated output and configuration.
5. **Apply one evidence-backed fix.** Keep the change limited to the confirmed cause; document rejected hypotheses when useful.
6. **Add a regression test.** Prefer a deterministic test at the failing boundary; include accessibility and browser behavior where relevant.
7. **Review and deliver.** Update `HANDOVER.md`, have the change reviewed, commit with a descriptive message, open/attach the PR, deploy only after merge, and run an end-to-end production check.

## Incident log template

```text
Date / reporter:
Production version:
Symptom and impact:
Browser/device:
Reproduction steps:
Expected / actual:
Request/response evidence:
Source-vs-deployed comparison:
Confirmed root cause:
Fix and regression test:
Review / PR / deployment:
End-to-end verification:
Follow-up:
```

## Communication expectations

Report the current hypothesis separately from confirmed facts. Give the user the smallest useful next action when more evidence is needed. At each checkpoint state what changed, what was tested, what remains uncertain, and any pending user or console action. Do not claim production resolution until the deployed version is verified end to end.

## Incident: invitation overlay remained visible

- **Initial hypotheses:** stale Cloudflare/Safari cache or an old bootstrap bundle appeared plausible because the issue followed deployment. Cache headers were hardened as a separate defensive improvement, but this did not establish the UI cause.
- **Decisive evidence:** `showApp()` set `#inviteGate.hidden = true`, while `public/styles.css` set `.invite-gate { display: grid; }`. The author rule overrode the browser’s hidden presentation rule, so the gate remained visible.
- **Permanent prevention:** add `.invite-gate[hidden] { display: none; }` and a regression assertion. Keep the production-version, evidence, source-vs-deployed, and end-to-end checks above as required steps for future incidents.

## Incident: verified user greeted as legacy profile name

- **Report:** `kmaz285@gmail.com` saw `Sudoku` in Profile and the greeting rather than the name derived from their verified Cloudflare Access identity.
- **Confirmed root cause:** legacy bootstrap copied the old profile row into tenant settings. Migration 0008 labelled every pre-existing row `user`, so the verified-identity seed deliberately skipped that inherited row.
- **Resolution:** the user explicitly accepted a one-time global compatibility reseed. Migration 0009 reclassifies every pre-0009 `user` marker to `default`, including `Sudoku`, because the prior schema has no audit marker separating inherited/default rows from historical explicit saves. Each household receives at most one verified-identity seed when its settings are next read; the cloud store then records `identity_seed`. Bootstrap copies are also marked `default`. A subsequent settings PATCH records `user` and is preserved.
- **Safety boundary:** no edge email header or browser identity value is used. The seed comes only from a validated Access JWT claim, with its sanitized verified-email local-part as fallback.
- **Regression coverage:** tenant tests cover `Sudoku` to `Kaushik Sudesna`, future explicit-edit preservation across a later identity change, and another household retaining its selected name. Apply 0009 before the Worker and perform an authenticated production Profile/greeting check.

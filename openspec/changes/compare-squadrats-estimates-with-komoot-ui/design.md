# Design

## Context

See proposal.md for motivation. The current estimator reads the loaded Squadrats collections at zooms 14 and 17, uses Squadrats' route tiler, and displays tile-count, Yard, and largest-square gains in the Komoot route analysis. The comparison target is the prospective gain shown by Komoot for the same drawn route.

## Goals / Non-Goals

**Goals:**
- Compare the same route and loaded account state in both interfaces.
- Check all six comparable values: three metrics at each of the two grid sizes.
- Make incomplete or unavailable comparisons visibly inconclusive.

**Non-Goals:**
- Verify awards after a completed ride or infer which later account changes came from this route.
- Automate login, call Squadrats account services, or store account credentials.
- Change estimator code or persist route, account, or screenshot data.

## Decisions

- Use the user's supplied positive-gain route in a browser already signed into Komoot and Squadrats, with the Squadrats extension enabled. This exercises the real loaded collection and native prospective-gain display without building a separate account-data path.
- Compare tile count, Yard growth, and largest-square growth independently for zooms 14 and 17. Record the six pairs in a temporary comparison table and report the outcome in the conversation; do not save account values or route details in the repository.
- Treat exact numeric agreement for each value shown by both interfaces as a match. If either collection is still loading, a grid is unavailable, or Komoot does not expose a corresponding value, report the case as inconclusive rather than passing it.
- Do not use post-ride totals as an oracle. The service processes recorded activities separately, and the resulting account change cannot be reliably attributed to this one route.

## Risks / Trade-offs

- [Risk] The browser may not have a complete, current Squadrats collection → Confirm the extension is enabled and both grid collections are ready before comparing; otherwise stop as inconclusive.
- [Risk] Komoot may format or round displayed values differently → Compare the underlying numeric meaning and the same metric, not text formatting; record any value that cannot be aligned as inconclusive.
- [Trade-off] A single route validates only one real-account case → Keep scope to the user's selected positive-gain route as requested; do not imply broad coverage.

## Migration Plan

Not applicable. This change defines a manual validation procedure and does not modify shipped code or data.

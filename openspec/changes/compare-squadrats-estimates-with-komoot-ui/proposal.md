# Proposal

## Why

The Squadrats estimator has algorithmic coverage, but it has not been checked against a real loaded account. The third-party service makes post-ride award attribution impractical, while Komoot already shows prospective gains for a drawn route; comparing those live estimates provides a direct validation path.

## What Changes

- Define a manual, browser-based comparison using the user's supplied positive-gain Komoot route, with the user logged into Komoot and Squadrats and the Squadrats extension enabled.
- Compare KRB's displayed gains with Komoot's prospective-gain values for tile count, Yard, and largest-square growth at both grid sizes (zoom 14 and zoom 17).
- Record matched values, mismatches, and metrics that Komoot does not expose. Treat missing account data or unavailable comparison values as inconclusive, not as zero or a pass.
- Explicitly exclude post-ride award verification, account credentials, new service access, automated account requests, and implementation changes.

## Capabilities

### New Capabilities

None. This change defines a validation procedure and does not introduce system behavior.

### Modified Capabilities

None. No existing capability requirements change.

## Impact

This is a manual validation plan for the existing `squadrats-estimate.js`, `map-bridge.js`, and `ride-dialog.js` behavior. It uses the existing Komoot and Squadrats browser integration and adds no runtime code, permissions, network access, or account handling.

# First-use guide

## Presentation

Three small, non-blocking guidance cards attached to the Routing Buddy floater. Show progress as 1 of 3, with Skip and Next; the last card uses Done. Back is available after the first card. The map and existing route remain usable.

| Step | Heading | Copy | Anchor |
| --- | --- | --- | --- |
| 1 | See the trails | Turn trail colours on or off here. Expand Routing Buddy for the colour legend and Settings. | Floater colour toggle |
| 2 | Understand your ride | Plan a route, then choose Analyse route for terrain, climbing and mapped warnings. Hover to highlight a section; click to zoom. | Analyse route button |
| 3 | Keep useful moments | Preview proposed POIs, tick the points you want and add them to your route. Save in Komoot to keep them. | POI preview when visible; otherwise Analyse route with a small example POI card |

The guide explains the actions; Next never runs analysis, changes map preferences, generates suggestions or inserts POIs. Empty routes can complete all three steps. No interaction with a real POI is required to finish onboarding.

## Once per install

- Wait for the first supported Komoot map and the floater to be ready. Do not show the guide on unrelated pages or the extension settings page.
- Keep a local installation marker, shared across this browser's extension tabs and separate from synced preferences.
- A background-owned, serialized claim prevents two ready tabs showing the guide simultaneously. Write the seen marker before presenting the first card.
- Skip, Done, Escape, navigation and browser closure never cause another automatic display. Extension/browser updates preserve the marker; a fresh installation gets a fresh guide.
- Existing installations with no marker receive it once when this guide first becomes available.
- Settings offers Show quick guide for an intentional replay, without resetting the automatic-display marker.

## Interaction and validation

Use visible keyboard focus, labelled controls, at least 44 px touch targets and reduced-motion positioning. Escape dismisses the guide. Restore focus to the floater after dismissal. Reposition the card when the floater moves or the viewport changes; keep it fully onscreen. Use the same colours, typography and button styling as the analysis panel.

Test first eligible use, unrelated pages, simultaneous tabs, reload, interrupted guides, Skip/Done/Escape, updates, manual replay, missing routes, keyboard navigation and narrow layouts. Verify that completing onboarding sends no route-analysis request and makes no route changes.

This is a design plan; onboarding implementation is not included yet.

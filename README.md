# Komoot Routing Buddy

Make mountain bike trails easier to read on Komoot. Colour S0–S5 trails, show mapped hazards and check the trails along your planned route. **Komoot Routing Buddy does not change your route or Komoot’s routing decisions.**

## What it does

- Choose trail colours and the difficulty levels to highlight, with or without Komoot’s MTB layer.
- Show mapped mud, overgrown sections, fallen trees, obstacles and trail widths.
- Check trails against your maximum difficulty and minimum width; click a warning to jump to it on the map.
- Remember your map layers, sidebar and floating panel position.
- Adjust Squadrats opacity and place its squares below roads and trails. Requires the separate Squadrats extension.

Works on Komoot’s planner, route editing and full-screen map pages. Desktop Chrome/Brave and Firefox packages share the same features. Mobile has not been validated.

## Install or update

Get the appropriate file from [GitHub Releases](https://github.com/redfellow/komoot-routing-buddy/releases). Packages include Finland data and are about 150 MB each.

### Chrome / Brave

1. Download the `chrome--` ZIP and extract it to a folder you will keep.
2. Open `chrome://extensions` or `brave://extensions` and enable **Developer mode**.
3. Choose **Load unpacked** and select the extracted folder.
4. Wait for the **Local Finland data** tab to finish importing. It closes automatically.
5. Open a Komoot map. Use the floating cog to change settings.

To update, replace the files in the same folder with the new Chrome package, then click **Reload** on the extension’s card. Your preferences and local data remain in the browser.

### Firefox

For a permanent installation, use the signed Firefox `.xpi` when provided. The `firefox--` ZIP is an unsigned development package: extract it, open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on**, and select its `manifest.json`. Temporary installations end when Firefox closes. See [Mozilla’s installation guidance](https://extensionworkshop.com/documentation/publish/install-self-distributed/).

## Check trails

Click the magnifying glass beside the cog. Choose your limits and select **Check trails**. Defaults are **S1**, **0.4m** minimum width and hazards disallowed. These choices are separate from map colours.

The checker assesses MTB-rated, unpaved trails. Roads, streets, cycleways and paved paths are excluded. Missing ratings, widths or surface information are reported where relevant; uncertain matches are not checked. Click a warning to centre the map on it. **Allow hazards** skips mud, vegetation and obstacles, but still checks difficulty and width.

If online data is needed, progress shows cached and downloaded areas. Temporary failures retry automatically; **Cancel** stops the check and **Retry** keeps completed areas. Editing the route clears its old results.

## Finland data and updates

Finland data is bundled and imported automatically, so covered map areas and trail checks normally need no online OSM queries. Outside coverage, the extension uses the Overpass API. These public servers can be slow or temporarily unavailable.

Open **Local Finland data** in settings to see the data date or update it. Weekly updates are on by default. A country update downloads roughly 770 MB and takes several minutes; allow several GB of free disk space. Keep its background tab open. You can pause and resume, and your previous data stays usable until the update succeeds.

**Update current route from OSM** fetches fresh data just around that route. Successful results are kept for seven days. **Clear OSM cache** clears online data and route refreshes, but keeps the Finland snapshot.

## Data and privacy

Trail conditions come from OpenStreetMap and may be missing or outdated; this is not live reporting or a guarantee of suitability. Data is [© OpenStreetMap contributors, ODbL](https://www.openstreetmap.org/copyright).

Preferences, country data and route matching stay in your browser. There is no analytics or upload to a project-operated server. Geofabrik supplies public Finland downloads. Overpass providers (Private.coffee, VK Maps and overpass-api.de) receive map or route-area bounds when online data is needed, along with normal network information such as your IP address. **Show hazards** controls map overlays; explicit trail checks and country updates have separate controls.

## Preview

![Default map with trail colours](map-default.png)

![Satellite map with Squadrats faded](map-satellite.png)

![Komoot map without the extension](krb-disabled.png)

## Contributing

See [developer notes](READMORE.md), the [release guide](docs/RELEASING.md) and [local OSM guide](docs/LOCAL-OSM.md).

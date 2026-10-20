"""Refresh the bundled Finland road-reference overlay from public OSM data."""
import argparse
from collections import defaultdict, deque
import json
import re
from pathlib import Path
import urllib.parse
import urllib.request

QUERY = '[out:json][timeout:180];area["ISO3166-1"="FI"]["admin_level"="2"]->.fi;way(area.fi)["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified)$"]["ref"];out tags geom;'


def simplify(points, tolerance=0.00002):
	if len(points) < 3:
		return points
	keep = {0, len(points) - 1}
	pending = [(0, len(points) - 1)]
	while pending:
		start, end = pending.pop()
		a, b = points[start], points[end]
		dx, dy = (b[0] - a[0]) * 0.5, b[1] - a[1]
		length = dx * dx + dy * dy
		maximum, chosen = 0, None
		for index in range(start + 1, end):
			x, y = (points[index][0] - a[0]) * 0.5, points[index][1] - a[1]
			t = max(0, min(1, (x * dx + y * dy) / length)) if length else 0
			deviation = (x - t * dx) ** 2 + (y - t * dy) ** 2
			if deviation > maximum:
				maximum, chosen = deviation, index
		if chosen is not None and maximum > tolerance ** 2:
			keep.add(chosen)
			pending.extend([(start, chosen), (chosen, end)])
	return [points[index] for index in sorted(keep)]


def convert(data):
	features = []
	for way in data["elements"]:
		tags = way.get("tags", {})
		points = [[round(p["lon"], 6), round(p["lat"], 6)] for p in way.get("geometry", [])]
		if len(points) < 2 or not tags.get("ref"):
			continue
		european = " / ".join(dict.fromkeys("E " + str(int(match.group(1))) for token in tags.get("int_ref", "").split(";") if (match := re.fullmatch(r"E\s*(\d{1,3})", token.strip(), re.I))))
		properties = {"ref": tags["ref"], "european": european, "highway": tags.get("highway", "")}
		features.append({"type": "Feature", "properties": properties, "geometry": {"type": "LineString", "coordinates": points}})
	features = merge(features)
	return {"type": "FeatureCollection", "attribution": "© OpenStreetMap contributors (ODbL)", "osmTimestamp": data.get("osm3s", {}).get("timestamp_osm_base"), "features": features}


def merge(features):
	groups = defaultdict(list)
	for feature in features:
		groups[json.dumps(feature["properties"], sort_keys=True)].append(feature["geometry"]["coordinates"])
	result = []
	for properties, lines in groups.items():
		ends = defaultdict(list)
		for index, points in enumerate(lines):
			ends[tuple(points[0])].append(index)
			ends[tuple(points[-1])].append(index)
		used = set()
		for index, points in enumerate(lines):
			if index in used:
				continue
			used.add(index)
			joined = deque(points)
			for front in [False, True]:
				while True:
					endpoint = tuple(joined[0] if front else joined[-1])
					candidates = ends[endpoint]
					remaining = [candidate for candidate in candidates if candidate not in used]
					if len(candidates) != 2 or len(remaining) != 1:
						break
					chosen = remaining[0]
					used.add(chosen)
					next_line = lines[chosen]
					if tuple(next_line[0]) != endpoint:
						next_line = list(reversed(next_line))
					if front:
						joined.extendleft(next_line[1:])
					else:
						joined.extend(next_line[1:])
			result.append({"type": "Feature", "properties": json.loads(properties), "geometry": {"type": "LineString", "coordinates": simplify(list(joined))}})
	return result


def from_pbf(path):
	import osmium
	members = {}
	class Relations(osmium.SimpleHandler):
		def relation(self, relation):
			if relation.tags.get("network") != "e-road" or not relation.tags.get("ref"):
				return
			for member in relation.members:
				if member.type == "w":
					members.setdefault(member.ref, set()).add(relation.tags["ref"])
	print("Reading E-road relations…", flush=True)
	Relations().apply_file(str(path))
	ways = []
	class Ways(osmium.SimpleHandler):
		def way(self, way):
			tags = dict(way.tags)
			if tags.get("highway") not in {"motorway", "trunk", "primary", "secondary", "tertiary", "unclassified"} or not tags.get("ref"):
				return
			if way.id in members:
				tags["int_ref"] = ";".join(sorted(members[way.id] | set(tags.get("int_ref", "").split(";"))))
			ways.append({"tags": tags, "geometry": [{"lon": node.lon, "lat": node.lat} for node in way.nodes]})
	print("Reading numbered road geometry…", flush=True)
	Ways().apply_file(str(path), locations=True, idx="flex_mem")
	with osmium.io.Reader(str(path)) as reader:
		timestamp = reader.header().get("osmosis_replication_timestamp")
	return {"elements": ways, "osm3s": {"timestamp_osm_base": timestamp}}


def main():
	parser = argparse.ArgumentParser(description=__doc__)
	parser.add_argument("--input", type=Path)
	parser.add_argument("--pbf", type=Path)
	parser.add_argument("--coverage", type=Path)
	parser.add_argument("--output", type=Path, default=Path("road-references-fi.js"))
	args = parser.parse_args()
	if args.pbf:
		data = from_pbf(args.pbf)
	elif args.input:
		data = json.loads(args.input.read_text())
	else:
		request = urllib.request.Request("https://overpass.private.coffee/api/interpreter", data=urllib.parse.urlencode({"data": QUERY}).encode(), headers={"User-Agent": "KomootRoutingBuddy-road-references/1"})
		with urllib.request.urlopen(request, timeout=240) as response:
			data = json.load(response)
		Path("/tmp/krb-road-references-raw.json").write_text(json.dumps(data))
	if data.get("remark"):
		raise RuntimeError(data["remark"])
	result = convert(data)
	if args.pbf:
		result["source"] = "https://download.geofabrik.de/europe/" + args.pbf.name
	if not result["features"]:
		raise RuntimeError("No numbered roads returned")
	args.output.parent.mkdir(parents=True, exist_ok=True)
	coverage_path = args.coverage
	if coverage_path is None:
		release = json.loads(Path("local-osm-data/release.json").read_text())
		coverage_path = Path("local-osm-data") / release["directory"] / "manifest.json"
	coverage = json.loads(coverage_path.read_text())["coverage"]
	boundary = {"type": "MultiPolygon", "coordinates": [[ring["coordinates"]] for ring in coverage["rings"] if not ring["hole"]]}
	args.output.write_text("// OpenStreetMap contributors, ODbL 1.0. See docs/ROAD-NUMBERS.md.\n" + "globalThis.KrbRoadReferencesFI = " + json.dumps({"data": result, "boundary": boundary}, separators=(",", ":")) + ";\n")
	print(f'{len(result["features"])} roads, {args.output.stat().st_size} bytes, OSM {result["osmTimestamp"]}')


if __name__ == "__main__":
	main()

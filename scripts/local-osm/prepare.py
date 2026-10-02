"""Prepare a versioned Finland snapshot; no extension build or runtime changes."""
import argparse
import collections
import datetime
import gzip
import hashlib
import json
from importlib.metadata import version
import math
from pathlib import Path
import resource
import shutil
import sys
import tempfile
import time
import urllib.request

import osmium

KEYS = "highway area mtb:scale width est_width surface obstacle overgrown barrier hazard hazard:forward hazard:backward layer bridge tunnel".split()
HAZARDS = set("obstacle overgrown barrier hazard hazard:forward hazard:backward".split())
HIGHWAYS = {"path", "track", "footway", "bridleway", "cycleway"}
BASE = "https://download.geofabrik.de/europe/"


class PreparationError(Exception):
	pass


def digest(path, algorithm="sha256"):
	h = hashlib.new(algorithm)
	with open(path, "rb") as stream:
		for block in iter(lambda: stream.read(1024 * 1024), b""):
			h.update(block)
	return h.hexdigest()


def download(url, destination):
	request = urllib.request.Request(url, headers={"User-Agent": "KomootRoutingBuddy-local-data/1"})
	with urllib.request.urlopen(request, timeout=120) as response, open(destination, "wb") as output:
		shutil.copyfileobj(response, output)
		return response.geturl()


def polygon(path):
	lines = iter(Path(path).read_text().splitlines())
	next(lines, None)
	rings = []
	finished = False
	for name in lines:
		name = name.strip()
		if not name:
			continue
		if name == "END":
			finished = True
			break
		points = []
		for line in lines:
			if line.strip() == "END":
				break
			values = line.split()
			if len(values) != 2:
				raise PreparationError("Invalid coverage polygon coordinate")
			point = [float(v) for v in values]
			validate_point(*point)
			points.append(point)
		else:
			raise PreparationError("Unterminated coverage ring")
		if len(points) < 4 or points[0] != points[-1]:
			raise PreparationError("Coverage rings must be closed and have at least four points")
		rings.append({"hole": name.startswith("!"), "coordinates": points})
	if not finished:
		raise PreparationError("Unterminated coverage polygon")
	if not rings or not any(not ring["hole"] for ring in rings):
		raise PreparationError("Missing coverage polygon")
	return {"format": "osm-poly-rings-v1", "rings": rings}


def validate_point(lon, lat):
	if not math.isfinite(lon) or not math.isfinite(lat) or not -180 <= lon <= 180 or not -90 <= lat <= 90:
		raise PreparationError("Invalid geometry coordinate")


class Shards:
	def __init__(self, root):
		self.root = root
		self.entries = {}
		self.counts = collections.Counter()

	def emit(self, item):
		points = item.get("geometry", [item] if item["type"] == "node" else [])
		if not points or (item["type"] == "way" and (len(points) < 2 or len(points) != len(item["nodes"]))):
			raise PreparationError("Missing way geometry or node membership")
		for point in points:
			validate_point(point["lon"], point["lat"])
		# One copy per feature. Directory bounds include the ENTIRE geometry,
		# so crossing ways are discoverable outside their assigned tile.
		key = f"{math.floor(points[0]['lon'] * 4)}_{math.floor(points[0]['lat'] * 4)}"
		bounds = [min(p["lon"] for p in points), min(p["lat"] for p in points), max(p["lon"] for p in points), max(p["lat"] for p in points)]
		entry = self.entries.setdefault(key, {"file": key + ".ndjson.gz", "bounds": bounds[:], "records": 0})
		entry["bounds"] = [min(entry["bounds"][0], bounds[0]), min(entry["bounds"][1], bounds[1]), max(entry["bounds"][2], bounds[2]), max(entry["bounds"][3], bounds[3])]
		entry["records"] += 1
		self.counts[item["type"]] += 1
		with open(self.root / (key + ".ndjson"), "a", encoding="utf-8") as output:
			output.write(json.dumps(item, separators=(",", ":"), sort_keys=True) + "\n")

	def finish(self):
		result = []
		for key, entry in sorted(self.entries.items()):
			source = self.root / (key + ".ndjson")
			target = self.root / entry["file"]
			with open(source, "rb") as raw, open(target, "wb") as zipped:
				with gzip.GzipFile(filename="", fileobj=zipped, mode="wb", compresslevel=6, mtime=0) as output:
					shutil.copyfileobj(raw, output)
			entry.update(bytes=target.stat().st_size, rawBytes=source.stat().st_size, sha256=digest(target))
			source.unlink()
			result.append(entry)
		return result


class Extract(osmium.SimpleHandler):
	def __init__(self, shards):
		super().__init__()
		self.shards = shards
		self.nodes = {}
		self.members = set()
		self.last_node = 0
		self.last_way = 0
		self.ways_started = False

	def node(self, node):
		if self.ways_started or node.id <= self.last_node:
			raise PreparationError("Source must have unique ascending nodes before ways")
		self.last_node = node.id
		if any(key in node.tags for key in HAZARDS):
			self.nodes[node.id] = {"type": "node", "id": node.id, "lat": node.lat, "lon": node.lon, "tags": {k: v for k, v in node.tags if k in KEYS}}

	def way(self, way):
		self.ways_started = True
		if way.id <= self.last_way:
			raise PreparationError("Source must have unique ascending ways")
		self.last_way = way.id
		if way.tags.get("highway") not in HIGHWAYS or way.tags.get("area") == "yes":
			return
		self.shards.emit({"type": "way", "id": way.id, "tags": {k: v for k, v in way.tags if k in KEYS}, "nodes": [n.ref for n in way.nodes], "geometry": [{"lat": n.lat, "lon": n.lon} for n in way.nodes]})
		self.members.update(n.ref for n in way.nodes if n.ref in self.nodes)


def prepare(source, coverage, output, expected_md5, source_url):
	start = time.monotonic()
	if version("osmium") != "4.3.1":
		raise PreparationError("Install the pinned requirements before preparing data")
	if output.exists():
		raise PreparationError("Output already exists; choose a new snapshot directory")
	if digest(source, "md5") != expected_md5.lower():
		raise PreparationError("Source MD5 does not match provider checksum")
	coverage_data = polygon(coverage)
	with osmium.io.Reader(str(source)) as reader:
		header = reader.header()
		timestamp = header.get("osmosis_replication_timestamp")
		sequence = header.get("osmosis_replication_sequence_number")
	if not timestamp:
		raise PreparationError("Source has no snapshot timestamp")
	datetime.datetime.strptime(timestamp, "%Y-%m-%dT%H:%M:%SZ")
	output.parent.mkdir(parents=True, exist_ok=True)
	staging = Path(tempfile.mkdtemp(prefix=".preparing-", dir=output.parent))
	try:
		shards = Shards(staging)
		extractor = Extract(shards)
		extractor.apply_file(str(source), locations=True, idx="sparse_mem_array", filters=[osmium.filter.EmptyTagFilter()])
		for node_id in sorted(extractor.members):
			shards.emit(extractor.nodes[node_id])
		if not shards.counts["way"]:
			raise PreparationError("No relevant ways found; refusing empty Finland snapshot")
		entries = shards.finish()
		manifest = {"schemaVersion": 1, "region": "finland", "snapshotAt": timestamp, "replicationSequence": sequence, "source": {"url": source_url, "bytes": source.stat().st_size, "md5": expected_md5.lower(), "sha256": digest(source)}, "coverage": coverage_data, "coverageSha256": digest(coverage), "license": "ODbL-1.0", "attribution": "© OpenStreetMap contributors", "licenseUrl": "https://www.openstreetmap.org/copyright", "parser": "osmium==4.3.1", "tags": KEYS, "highways": sorted(HIGHWAYS), "counts": dict(shards.counts), "shards": entries}
		(staging / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
		# Read back every shard before exposing the completed snapshot.
		for entry in entries:
			with gzip.open(staging / entry["file"], "rt") as stream:
				count = sum(1 for line in stream if json.loads(line))
			if count != entry["records"] or digest(staging / entry["file"]) != entry["sha256"]:
				raise PreparationError("Output validation failed")
		staging.rename(output)
	except BaseException:
		shutil.rmtree(staging)
		raise
	return {"elapsedSeconds": time.monotonic() - start, "peakRssBytes": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * (1 if sys.platform == "darwin" else 1024), "payloadBytes": sum(e["bytes"] for e in entries), "manifestBytes": (output / "manifest.json").stat().st_size, "shards": len(entries), "counts": dict(shards.counts)}


def main():
	parser = argparse.ArgumentParser(description=__doc__)
	parser.add_argument("--source", type=Path)
	parser.add_argument("--coverage", type=Path)
	parser.add_argument("--md5", help="Provider MD5 for an existing source")
	parser.add_argument("--source-url", default=BASE + "finland-latest.osm.pbf")
	parser.add_argument("--output", type=Path, required=True)
	args = parser.parse_args()
	if args.source:
		if not args.coverage or not args.md5:
			parser.error("--source requires --coverage and --md5")
		result = prepare(args.source, args.coverage, args.output, args.md5, args.source_url)
	else:
		with tempfile.TemporaryDirectory(prefix="krb-osm-source-") as temp:
			root = Path(temp)
			url = download(BASE + "finland-latest.osm.pbf", root / "source.pbf")
			download(url + ".md5", root / "source.md5")
			download(BASE + "finland.poly", root / "coverage.poly")
			result = prepare(root / "source.pbf", root / "coverage.poly", args.output, (root / "source.md5").read_text().split()[0], url)
	print(json.dumps(result, indent=2))


if __name__ == "__main__":
	main()

import gzip
import io
import sys
from contextlib import redirect_stdout
from unittest.mock import patch
import json
from pathlib import Path
import tempfile
import unittest

import osmium
from prepare import PreparationError, Shards, digest, polygon, prepare, main


class PreparationTests(unittest.TestCase):
	def setUp(self):
		self.temp = tempfile.TemporaryDirectory()
		self.addCleanup(self.temp.cleanup)
		self.root = Path(self.temp.name)
		self.coverage = self.root / "coverage.poly"
		self.coverage.write_text("fixture\n1\n23 60\n25 60\n25 62\n23 60\nEND\nEND\n")
		self.source = self.root / "fixture.osm.pbf"
		header = osmium.io.Header()
		header.set("osmosis_replication_timestamp", "2026-09-30T20:22:42Z")
		with osmium.SimpleWriter(str(self.source), header=header) as writer:
			for node_id, tags in [(1, {}), (2, {"barrier": "log"}), (3, {}), (4, {"hazard": "slippery"}), (5, {"obstacle": "vegetation"})]:
				writer.add_node(osmium.osm.mutable.Node(id=node_id, location=(24 + node_id / 10, 61), tags=tags))
			for way_id, tags, nodes in [
				(10, {"highway": "path", "mtb:scale": "2", "surface": "mud", "width": "0.4", "name": "Drop this"}, [1, 2, 3]),
				(11, {"highway": "track"}, [3, 4]),
				(12, {"highway": "cycleway", "surface": "asphalt"}, [1, 3]),
				(13, {"highway": "residential"}, [4, 5]),
				(14, {"highway": "path", "area": "yes"}, [1, 5, 1]),
			]:
				writer.add_way(osmium.osm.mutable.Way(id=way_id, tags=tags, nodes=nodes))

	def run_prepare(self, name="output"):
		output = self.root / name
		result = prepare(self.source, self.coverage, output, digest(self.source, "md5"), "fixture")
		return output, result

	def test_preservation_and_reproducibility(self):
		output, result = self.run_prepare()
		manifest = json.loads((output / "manifest.json").read_text())
		records = {}
		for shard in manifest["shards"]:
			with gzip.open(output / shard["file"], "rt") as stream:
				for line in stream:
					item = json.loads(line)
					records[(item["type"], item["id"])] = item
		self.assertEqual(result["counts"], {"way": 3, "node": 2})
		self.assertEqual(records[("way", 10)]["nodes"], [1, 2, 3])
		self.assertEqual(records[("way", 10)]["geometry"][1], {"lat": 61, "lon": 24.2})
		self.assertEqual(records[("node", 2)]["tags"], {"barrier": "log"})
		self.assertNotIn("name", records[("way", 10)]["tags"])
		self.assertEqual(records[("way", 11)]["tags"], {"highway": "track"})
		self.assertEqual(records[("way", 12)]["tags"]["highway"], "cycleway")
		self.assertNotIn(("node", 5), records)
		self.assertEqual(manifest["coverage"], polygon(self.coverage))
		# Polygon covers empty space too: coverage is not inferred from features.
		self.assertEqual(manifest["coverage"]["rings"][0]["coordinates"][0], [23, 60])
		other, _ = self.run_prepare("repeat")
		self.assertEqual(sorted(p.name for p in output.iterdir()), sorted(p.name for p in other.iterdir()))
		for path in output.iterdir():
			self.assertEqual(path.read_bytes(), (other / path.name).read_bytes())

	def test_bad_checksum_and_existing_output(self):
		with self.assertRaises(PreparationError):
			prepare(self.source, self.coverage, self.root / "bad", "0" * 32, "fixture")
		self.assertFalse((self.root / "bad").exists())
		output, _ = self.run_prepare()
		original = (output / "manifest.json").read_bytes()
		with self.assertRaises(PreparationError):
			self.run_prepare()
		self.assertEqual(original, (output / "manifest.json").read_bytes())

	def test_invalid_polygon(self):
		self.coverage.write_text("fixture\n1\n23 60\nEND\nEND\n")
		with self.assertRaises(PreparationError):
			self.run_prepare()
		self.assertFalse((self.root / "output").exists())


	def test_failed_extraction_removes_staging(self):
		broken = self.root / "broken.osm.pbf"
		header = osmium.io.Header()
		header.set("osmosis_replication_timestamp", "2026-09-30T20:22:42Z")
		with osmium.SimpleWriter(str(broken), header=header) as writer:
			writer.add_node(osmium.osm.mutable.Node(id=1, location=(24, 61)))
			writer.add_way(osmium.osm.mutable.Way(id=10, tags={"highway": "path"}, nodes=[1, 999]))
		with self.assertRaises(osmium.InvalidLocationError):
			prepare(broken, self.coverage, self.root / "broken-output", digest(broken, "md5"), "fixture")
		self.assertFalse((self.root / "broken-output").exists())
		self.assertEqual(list(self.root.glob(".preparing-*")), [])

	def test_empty_source_is_not_published(self):
		empty = self.root / "empty.osm.pbf"
		header = osmium.io.Header()
		header.set("osmosis_replication_timestamp", "2026-09-30T20:22:42Z")
		with osmium.SimpleWriter(str(empty), header=header) as writer:
			writer.add_node(osmium.osm.mutable.Node(id=1, location=(24, 61)))
		with self.assertRaises(PreparationError):
			prepare(empty, self.coverage, self.root / "empty-output", digest(empty, "md5"), "fixture")
		self.assertEqual(list(self.root.glob(".preparing-*")), [])

	def test_crossing_way_bounds_and_invalid_geometry(self):
		shards = Shards(self.root)
		shards.emit({"type": "way", "id": 1, "nodes": [1, 2], "geometry": [{"lon": 23, "lat": 60}, {"lon": 25, "lat": 62}], "tags": {}})
		entry = shards.finish()[0]
		self.assertEqual(entry["bounds"], [23, 60, 25, 62])
		with self.assertRaises(PreparationError):
			shards.emit({"type": "way", "id": 2, "nodes": [1], "geometry": []})



	def test_cli_uses_pinned_source_url_for_release_preparation(self):
		pinned = "https://download.geofabrik.de/europe/finland-260930.osm.pbf"
		calls = []

		def fake_download(url, destination):
			calls.append(url)
			if url.endswith(".osm.pbf"):
				destination.write_bytes(self.source.read_bytes())
			elif url.endswith(".md5"):
				destination.write_text(digest(self.source, "md5"))
			else:
				destination.write_bytes(self.coverage.read_bytes())
			return url

		output = self.root / "release"
		with patch("prepare.download", fake_download), patch.object(sys, "argv", ["prepare.py", "--source-url", pinned, "--output", str(output)]), redirect_stdout(io.StringIO()):
			main()
		self.assertEqual(calls[0], pinned)
		self.assertEqual(json.loads((output / "manifest.json").read_text())["source"]["url"], pinned)

if __name__ == "__main__":
	unittest.main()

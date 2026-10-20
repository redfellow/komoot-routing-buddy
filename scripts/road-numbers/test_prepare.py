import importlib.util
from pathlib import Path
import unittest
import tempfile

spec = importlib.util.spec_from_file_location("road_prepare", Path(__file__).with_name("prepare.py"))
prepare = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prepare)


class RoadReferencesTest(unittest.TestCase):
	def test_european_refs_are_explicit_normalized_and_deduplicated(self):
		data = {"elements": [{"tags": {"ref": "9", "int_ref": "E63; E 63; e12;E08;invalid", "highway": "motorway"}, "geometry": [{"lon": 23, "lat": 61}, {"lon": 24, "lat": 61}]}]}
		result = prepare.convert(data)["features"][0]
		self.assertEqual(result["properties"]["ref"], "9")
		self.assertEqual(result["properties"]["european"], "E 63 / E 12 / E 8")
		data["elements"][0]["tags"].pop("int_ref")
		self.assertEqual(prepare.convert(data)["features"][0]["properties"]["european"], "")

	def test_join_contiguous_same_reference_but_preserve_route_changes(self):
		features = [{"properties": {"ref": ref}, "geometry": {"coordinates": coords}} for ref, coords in [("9", [[0, 0], [1, 0]]), ("9", [[2, 0], [1, 0]]), ("12", [[2, 0], [3, 0]])]]
		merged = prepare.merge(features)
		self.assertEqual(len(merged), 2)
		self.assertEqual(merged[0]["geometry"]["coordinates"], [[0, 0], [2, 0]])

	def test_simplification_preserves_bends_and_endpoints(self):
		points = [[23, 61], [23.001, 61], [23.002, 61], [23.002, 61.002]]
		self.assertEqual(prepare.simplify(points), [points[0], points[2], points[3]])

	def test_pbf_adapter_reads_e_road_relation_membership(self):
		with tempfile.TemporaryDirectory() as directory:
			source = Path(directory) / "roads.osm"
			source.write_text('<osm version="0.6"><node id="1" lat="61" lon="23"/><node id="2" lat="61.01" lon="23.01"/><way id="10"><nd ref="1"/><nd ref="2"/><tag k="highway" v="primary"/><tag k="ref" v="9"/></way><relation id="20"><member type="way" ref="10" role=""/><tag k="type" v="route"/><tag k="route" v="road"/><tag k="network" v="e-road"/><tag k="ref" v="E63"/></relation></osm>')
			features = prepare.convert(prepare.from_pbf(source))["features"]
			self.assertEqual(len(features), 1)
			self.assertEqual(features[0]["properties"]["european"], "E 63")
			self.assertEqual(features[0]["geometry"]["coordinates"], [[23.0, 61.0], [23.01, 61.01]])


if __name__ == "__main__":
	unittest.main()

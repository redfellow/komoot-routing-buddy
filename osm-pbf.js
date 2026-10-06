// Bounded reader for the current, sorted OSM PBF extract format.
(function () {
	class PbfError extends Error {
		constructor(message) {
			super(message);
			this.name = "PbfError";
		}
	}
	const decoder = new TextDecoder("utf-8", { fatal: true });
	const keys = new Set(
		"highway area mtb:scale width est_width surface obstacle overgrown barrier hazard hazard:forward hazard:backward layer bridge tunnel".split(
			" ",
		),
	);
	class Reader {
		constructor(bytes) {
			this.bytes = bytes;
			this.position = 0;
		}
		uint() {
			let value = 0,
				scale = 1;
			for (let i = 0; i < 10; i++) {
				if (this.position >= this.bytes.length) throw new PbfError("Truncated protobuf integer");
				const byte = this.bytes[this.position++];
				value += (byte & 127) * scale;
				if (!(byte & 128)) {
					if (!Number.isSafeInteger(value))
						throw new PbfError("Protobuf integer exceeds supported precision");
					return value;
				}
				scale *= 128;
			}
			throw new PbfError("Invalid protobuf integer");
		}
		sint() {
			const value = this.uint();
			return value % 2 ? -(value + 1) / 2 : value / 2;
		}
		bytesValue() {
			const length = this.uint(),
				end = this.position + length;
			if (end > this.bytes.length) throw new PbfError("Truncated protobuf bytes");
			const bytes = this.bytes.subarray(this.position, end);
			this.position = end;
			return bytes;
		}
		fields(visit) {
			while (this.position < this.bytes.length) {
				const tag = this.uint(),
					field = Math.floor(tag / 8),
					wire = tag % 8;
				if (!field) throw new PbfError("Invalid protobuf field");
				if (wire === 0) visit(field, wire, this.uint());
				else if (wire === 2) visit(field, wire, this.bytesValue());
				else if (wire === 1 || wire === 5) {
					this.position += wire === 1 ? 8 : 4;
					if (this.position > this.bytes.length)
						throw new PbfError("Truncated protobuf fixed field");
				}
				else throw new PbfError("Unsupported protobuf wire type");
			}
		}
	}
	function fields(bytes) {
		const result = new Map();
		new Reader(bytes).fields(function (field, wire, value) {
			if (!result.has(field)) result.set(field, []);
			result.get(field).push({ wire, value });
		});
		return result;
	}
	function one(map, field, wire, fallback) {
		const values = map.get(field);
		if (!values) return fallback;
		if (values.length !== 1 || values[0].wire !== wire)
			throw new PbfError("Invalid protobuf scalar");
		return values[0].value;
	}
	function packed(map, field, signed = false) {
		const result = [];
		for (const { wire, value } of map.get(field) || []) {
			if (wire === 0) result.push(signed ? (value % 2 ? -(value + 1) / 2 : value / 2) : value);
			else if (wire === 2) {
				const reader = new Reader(value);
				while (reader.position < value.length) result.push(signed ? reader.sint() : reader.uint());
			}
			else throw new PbfError("Invalid packed protobuf field");
		}
		if (result.length > 1000000) throw new PbfError("Packed field exceeds memory budget");
		return result;
	}
	function tags(keyIds, values, strings) {
		if (keyIds.length !== values.length) throw new PbfError("Mismatched tag arrays");
		const result = {};
		for (let i = 0; i < keyIds.length; i++) {
			const key = strings[keyIds[i]],
				value = strings[values[i]];
			if (key === undefined || value === undefined)
				throw new PbfError("Invalid string table reference");
			if (keys.has(key)) result[key] = value;
		}
		return result;
	}
	function coordinate(value, offset, granularity, latitude) {
		const integer = value * granularity + offset;
		if (!Number.isSafeInteger(integer))
			throw new PbfError("Coordinate exceeds supported precision");
		const result = integer / 1000000000,
			limit = latitude ? 90 : 180;
		if (Math.abs(result) > limit) throw new PbfError("Invalid OSM coordinate");
		return result;
	}
	function primitive(bytes) {
		const map = fields(bytes),
			stringTable = one(map, 1, 2);
		if (!stringTable) throw new PbfError("Missing string table");
		const strings = (fields(stringTable).get(1) || []).map(function (item) {
			if (item.wire !== 2) throw new PbfError("Invalid string table");
			return decoder.decode(item.value);
		});
		const granularity = one(map, 17, 0, 100),
			latOffset = one(map, 19, 0, 0),
			lonOffset = one(map, 20, 0, 0);
		if (!Number.isSafeInteger(granularity) || granularity <= 0)
			throw new PbfError("Invalid coordinate granularity");
		const nodes = [],
			ways = [];
		for (const group of map.get(2) || []) {
			if (group.wire !== 2) throw new PbfError("Invalid primitive group");
			new Reader(group.value).fields(function (type, wire, data) {
				if (![1, 2, 3].includes(type)) return;
				if (wire !== 2) throw new PbfError("Invalid primitive object");
				const item = fields(data);
				if (type === 2) {
					const ids = packed(item, 1, true),
						latitudes = packed(item, 8, true),
						longitudes = packed(item, 9, true),
						denseTags = packed(item, 10);
					if (ids.length > 100000) throw new PbfError("Node block exceeds memory budget");
					if (ids.length !== latitudes.length || ids.length !== longitudes.length)
						throw new PbfError("Mismatched dense node coordinates");
					let id = 0,
						lat = 0,
						lon = 0,
						at = 0;
					for (let i = 0; i < ids.length; i++) {
						id += ids[i];
						lat += latitudes[i];
						lon += longitudes[i];
						const keyIds = [],
							values = [];
						if (denseTags.length) {
							while (at < denseTags.length && denseTags[at] !== 0) {
								keyIds.push(denseTags[at++]);
								values.push(denseTags[at++]);
							}
							if (denseTags[at++] !== 0) throw new PbfError("Truncated dense node tags");
						}
						nodes.push({
							id,
							lat: coordinate(lat, latOffset, granularity, true),
							lon: coordinate(lon, lonOffset, granularity, false),
							tags: tags(keyIds, values, strings),
						});
					}
					if (at !== denseTags.length) throw new PbfError("Extra dense node tags");
				}
				else if (type === 1) {
					const signed = function (field) {
						const value = one(item, field, 0);
						if (value === undefined) throw new PbfError("Missing node field");
						return value % 2 ? -(value + 1) / 2 : value / 2;
					};
					nodes.push({
						id: signed(1),
						lat: coordinate(signed(8), latOffset, granularity, true),
						lon: coordinate(signed(9), lonOffset, granularity, false),
						tags: tags(packed(item, 2), packed(item, 3), strings),
					});
				}
				else {
					let id = 0;
					ways.push({
						id: one(item, 1, 0),
						tags: tags(packed(item, 2), packed(item, 3), strings),
						nodes: packed(item, 8, true).map((delta) => (id += delta)),
					});
				}
			});
		}
		if (nodes.length > 100000 || ways.length > 100000 || ways.some((w) => w.nodes.length > 100000))
			throw new PbfError("Primitive block exceeds memory budget");
		return { nodes, ways };
	}
	async function inflate(bytes, maximum, expected) {
		const reader = new Blob([bytes])
				.stream()
				.pipeThrough(new DecompressionStream("deflate"))
				.getReader(),
			chunks = [];
		let size = 0;
		try {
			while (true) {
				const { value, done } = await reader.read();
				if (done) break;
				size += value.length;
				if (size > maximum || size > expected) throw new PbfError("Oversized PBF block");
				chunks.push(value);
			}
		}
		finally {
			await reader.cancel();
			reader.releaseLock();
		}
		if (size !== expected) throw new PbfError("PBF block size mismatch");
		const result = new Uint8Array(size);
		let at = 0;
		for (const chunk of chunks) {
			result.set(chunk, at);
			at += chunk.length;
		}
		return result;
	}
	async function read(source, visit, { signal, offset = 0, header, progress } = {}) {
		const maximum = 32 * 1024 * 1024;
		while (offset < source.size) {
			signal?.throwIfAborted();
			const prefix = await source.read(offset, 4);
			if (prefix.length !== 4) throw new PbfError("Truncated PBF block prefix");
			const length = new DataView(prefix.buffer, prefix.byteOffset, 4).getUint32(0);
			if (!length || length >= 65536) throw new PbfError("Invalid PBF header length");
			const blobHeader = fields(await source.read(offset + 4, length));
			const typeBytes = one(blobHeader, 1, 2),
				dataSize = one(blobHeader, 3, 0);
			if (
				!typeBytes ||
				!dataSize ||
				dataSize > maximum ||
				offset + 4 + length + dataSize > source.size
			)
				throw new PbfError("Invalid PBF blob length");
			const type = decoder.decode(typeBytes),
				blob = fields(await source.read(offset + 4 + length, dataSize));
			let data = one(blob, 1, 2);
			if (!data) {
				const compressed = one(blob, 3, 2),
					rawSize = one(blob, 2, 0);
				if (!compressed || !rawSize || rawSize > maximum)
					throw new PbfError("Unsupported PBF compression");
				data = await inflate(compressed, maximum, rawSize);
			}
			const end = offset + 4 + length + dataSize;
			if (type === "OSMHeader") {
				if (offset !== 0 || header) throw new PbfError("Unexpected PBF header");
				const h = fields(data),
					required = (h.get(4) || []).map((v) => decoder.decode(v.value));
				if (
					!required.includes("OsmSchema-V0.6") ||
					required.some((v) => !["OsmSchema-V0.6", "DenseNodes"].includes(v))
				)
					throw new PbfError("Unsupported required PBF features");
				const timestamp = one(h, 32, 0),
					sequence = one(h, 33, 0);
				if (!timestamp || !Number.isSafeInteger(timestamp))
					throw new PbfError("Missing PBF snapshot timestamp");
				header = {
					snapshotAt: new Date(timestamp * 1000).toISOString().replace(".000Z", "Z"),
					replicationSequence: sequence,
				};
				await visit({ nodes: [], ways: [] }, { offset: end, header });
			}
			else if (type === "OSMData") {
				if (!header) throw new PbfError("Missing PBF header");
				await visit(primitive(data), { offset: end, header });
			}
			else throw new PbfError("Unsupported PBF block type");
			offset = end;
			progress?.({ offset, total: source.size });
		}
		return header;
	}
	globalThis.KrbOsmPbf = { read, PbfError };
})();

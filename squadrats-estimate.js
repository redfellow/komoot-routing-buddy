// Sparse, cancellable award estimates. Never fetch account data or change Squadrats state.
(function () {
	const LIMIT = 500000;
	class EstimateError extends Error {
		constructor(message) {
			super(message);
			this.name = "EstimateError";
		}
	}
	function read(context, coordinates) {
		if (!context?.provider?.enabled) return { status: "unavailable", message: "Enable Squadrats to estimate gains." };
		if (typeof context.tiler?.getSquadrats !== "function" || typeof context.encode !== "function")
			return { status: "unavailable", message: "Squadrats route data is not ready." };
		if (!Array.isArray(coordinates) || coordinates.length < 2 || coordinates.length > 250000 ||
			coordinates.some((point) => !point || !Number.isFinite(point.lng) || !Number.isFinite(point.lat) || Math.abs(point.lng) > 180 || Math.abs(point.lat) > 90))
			return { status: "unavailable", message: "Route geometry is unavailable for Squadrats." };
		const grids = [];
		let encoded;
		for (const zoom of [14, 17]) {
			const raw = context.provider.raw?.[zoom];
			if (!(raw instanceof Set)) {
				grids.push({ zoom, error: "Collection not loaded" });
				continue;
			}
			if (raw.size > LIMIT) {
				grids.push({ zoom, error: "Collection exceeds the estimation limit" });
				continue;
			}
			try {
				// Use Squadrats' own tiling, including its corner and segment-crossing rules.
				encoded ??= context.encode.call(context.polyline, coordinates.flatMap((point) => [point.lng, point.lat]));
				const planned = context.tiler.getSquadrats([encoded], zoom);
				if (!(planned instanceof Set) && !Array.isArray(planned)) throw new EstimateError("Unsupported route tiles");
				if ((planned.size ?? planned.length) > LIMIT) throw new EstimateError("Route exceeds the estimation limit");
				grids.push({ zoom, visited: [...raw], planned: [...planned] });
			}
			catch (error) {
				grids.push({ zoom, error: error.message || "Route tiles unavailable" });
			}
		}
		return { status: "ready", grids };
	}
	async function estimate(data, signal) {
		let operations = 0;
		async function checkpoint() {
			signal?.throwIfAborted();
			if (++operations % 2048 === 0) {
				await new Promise(function (resolve) { setTimeout(resolve, 0); });
				signal?.throwIfAborted();
			}
		}
		async function cells(values, zoom) {
			if (!Array.isArray(values) || values.length > LIMIT) throw new EstimateError("Tile data exceeds the estimation limit");
			const size = 2 ** zoom, result = new Set();
			for (const value of values) {
				await checkpoint();
				if (typeof value !== "string" || !/^\d+-\d+$/.test(value)) throw new EstimateError("Unsupported Squadrats tile format");
				const [x, y] = value.split("-").map(Number);
				if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y) || x >= size || y >= size)
					throw new EstimateError("Invalid Squadrats tile coordinates");
				result.add(y * size + x);
			}
			return result;
		}
		async function metrics(tiles, zoom) {
			const size = 2 ** zoom, eligible = new Set(), squares = new Map();
			let square = 0, yard = 0;
			// Sort sparse occupied cells, never allocate a world-sized rectangular grid.
			const ordered = [...tiles].sort((a, b) => a - b);
			for (const id of ordered) {
				await checkpoint();
				const x = id % size, y = Math.floor(id / size);
				if (x > 0 && x < size - 1 && y > 0 && y < size - 1 &&
					tiles.has(id - 1) && tiles.has(id + 1) && tiles.has(id - size) && tiles.has(id + size)) eligible.add(id);
				const length = 1 + (x > 0 && y > 0 ? Math.min(squares.get(id - 1) || 0, squares.get(id - size) || 0, squares.get(id - size - 1) || 0) : 0);
				squares.set(id, length);
				square = Math.max(square, length);
			}
			while (eligible.size) {
				const first = eligible.values().next().value, stack = [first];
				eligible.delete(first);
				let count = 0;
				while (stack.length) {
					await checkpoint();
					const id = stack.pop(), x = id % size;
					count++;
					for (const next of [x > 0 ? id - 1 : -1, x < size - 1 ? id + 1 : -1, id - size, id + size]) {
						if (eligible.delete(next)) stack.push(next);
					}
				}
				yard = Math.max(yard, count);
			}
			return { count: tiles.size, yard, square };
		}
		if (data?.status !== "ready" || !Array.isArray(data.grids)) throw new EstimateError("Squadrats data unavailable");
		const result = [];
		for (const zoom of [14, 17]) {
			await checkpoint();
			const grid = data.grids.find((entry) => entry.zoom === zoom);
			if (!grid || grid.error) {
				result.push({ zoom, error: grid?.error || "Collection not loaded" });
				continue;
			}
			try {
				const visited = await cells(grid.visited, zoom), planned = await cells(grid.planned, zoom), combined = new Set(visited);
				for (const id of planned) combined.add(id);
				if (combined.size > LIMIT) throw new EstimateError("Combined tiles exceed the estimation limit");
				const before = await metrics(visited, zoom), after = combined.size === visited.size ? before : await metrics(combined, zoom);
				result.push({ zoom, before, after, gained: { count: after.count - before.count, yard: after.yard - before.yard, square: after.square - before.square } });
			}
			catch (error) {
				signal?.throwIfAborted();
				result.push({ zoom, error: error.message });
			}
		}
		return result;
	}
	globalThis.KrbSquadratsEstimate = { read, estimate, LIMIT, EstimateError };
})();

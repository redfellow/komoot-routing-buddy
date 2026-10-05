// Incremental MD5 for the provider's published transfer checksum (not authentication).
(function () {
	const shifts = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
	const constants = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) | 0);
	function create() {
		const state = new Int32Array([0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476]), pending = new Uint8Array(64);
		let used = 0, total = 0, ended = false;
		function block(bytes, offset) {
			const words = new DataView(bytes.buffer, bytes.byteOffset + offset, 64);
			let [a, b, c, d] = state;
			for (let i = 0; i < 64; i++) {
				const round = Math.floor(i / 16), shift = shifts[round * 4 + i % 4];
				const f = round === 0 ? b & c | ~b & d : round === 1 ? d & b | ~d & c : round === 2 ? b ^ c ^ d : c ^ (b | ~d);
				const word = round === 0 ? i : round === 1 ? (5 * i + 1) % 16 : round === 2 ? (3 * i + 5) % 16 : 7 * i % 16;
				const value = a + f + constants[i] + words.getInt32(word * 4, true) | 0;
				const previous = d; d = c; c = b; b = b + (value << shift | value >>> (32 - shift)) | 0; a = previous;
			}
			state[0] += a; state[1] += b; state[2] += c; state[3] += d;
		}
		function update(bytes) {
			if (ended) throw new Error("Checksum is already finalized");
			total += bytes.length; let at = 0;
			if (used) {
				const amount = Math.min(64 - used, bytes.length); pending.set(bytes.subarray(0, amount), used); used += amount; at = amount;
				if (used === 64) { block(pending, 0); used = 0; }
			}
			while (at + 64 <= bytes.length) { block(bytes, at); at += 64; }
			if (at < bytes.length) { pending.set(bytes.subarray(at), 0); used = bytes.length - at; }
		}
		function digest() {
			const bits = total * 8, padding = new Uint8Array(used < 56 ? 64 - used : 128 - used); padding[0] = 128;
			const view = new DataView(padding.buffer); view.setUint32(padding.length - 8, bits >>> 0, true); view.setUint32(padding.length - 4, Math.floor(bits / 4294967296), true);
			update(padding); ended = true;
			return Array.from(state, (value) => [0, 8, 16, 24].map((shift) => (value >>> shift & 255).toString(16).padStart(2, "0")).join("")).join("");
		}
		return { update, digest };
	}
	globalThis.KrbOsmMd5 = { create };
})();

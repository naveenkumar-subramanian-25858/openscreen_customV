import { describe, expect, it } from "vitest";
import { mixClickHitsToWav } from "./clickSoundExport";

const RATE = 1000;
const tick = (value: number, length = 4) => [new Float32Array(length).fill(value)];

/** The interleaved samples of the WAV the mixer returned, past its 44-byte header. */
const samplesOf = (wav: ArrayBuffer) => new Int16Array(wav, 44);

describe("mixClickHitsToWav", () => {
	it("places a press and a release at their programme seconds", () => {
		const wav = mixClickHitsToWav(
			[
				{ timeSec: 0.1, gain: 1, release: false },
				{ timeSec: 0.5, gain: 0.5, release: true },
			],
			{ down: tick(0.5), up: tick(0.8) },
			1,
			RATE,
		);
		const pcm = samplesOf(wav);
		expect(pcm).toHaveLength(1000 * 2);
		expect(pcm[99 * 2]).toBe(0);
		expect(pcm[100 * 2]).toBeCloseTo(0.5 * 0x7fff, -1);
		// A mono sample plays on both sides.
		expect(pcm[100 * 2 + 1]).toBe(pcm[100 * 2]);
		expect(pcm[500 * 2]).toBeCloseTo(0.4 * 0x7fff, -1);
		expect(pcm[600 * 2]).toBe(0);
	});

	it("saturates overlapping hits instead of wrapping, and cuts a hit that runs past the end", () => {
		const wav = mixClickHitsToWav(
			[
				{ timeSec: 0, gain: 1, release: false },
				{ timeSec: 0, gain: 1, release: false },
				{ timeSec: 0.999, gain: 1, release: false },
			],
			{ down: tick(0.9), up: tick(0.9) },
			1,
			RATE,
		);
		const pcm = samplesOf(wav);
		expect(pcm[0]).toBe(0x7fff);
		expect(pcm).toHaveLength(1000 * 2);
		expect(pcm[999 * 2]).toBeCloseTo(0.9 * 0x7fff, -1);
	});

	it("ignores hits with no usable time", () => {
		const wav = mixClickHitsToWav(
			[
				{ timeSec: Number.NaN, gain: 1, release: false },
				{ timeSec: -1, gain: 1, release: false },
			],
			{ down: tick(1), up: tick(1) },
			0.01,
			RATE,
		);
		expect(Math.max(...samplesOf(wav))).toBe(0);
	});

	it("writes a stereo 16-bit PCM header sized to its frames", () => {
		const wav = mixClickHitsToWav([], { down: tick(0), up: tick(0) }, 0.003, RATE);
		const view = new DataView(wav);
		const ascii = (offset: number, length: number) =>
			String.fromCharCode(...new Uint8Array(wav, offset, length));
		expect(ascii(0, 4)).toBe("RIFF");
		expect(ascii(8, 4)).toBe("WAVE");
		expect(view.getUint16(22, true)).toBe(2);
		expect(view.getUint32(24, true)).toBe(RATE);
		expect(view.getUint32(40, true)).toBe(3 * 2 * 2);
		expect(wav.byteLength).toBe(44 + 12);
	});
});

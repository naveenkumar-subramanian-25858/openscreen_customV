// The mouse-click sound as a file of its own.
//
// The normal export sums the click hits into the video's audio inside the compositor. This is the
// other way to hand the same sound over: the hits the export would have mixed (same placement, so
// speed regions and cuts are honoured), summed here into a stereo WAV as long as the video, to be
// laid under it in another editor. It does not depend on the "mouse clicks" toggle: asking for the
// separate file is the ask.

import type { ClickHit } from "./clickSound";
import {
	clickHitUrls,
	clickTakeOf,
	levelClickCues,
	loadClickCues,
	placeClickHits,
} from "./clickSound";
import type { AxcutDocument } from "./schema";
import { getEditorSettings } from "./store/editorSettings";

export const CLICK_SOUND_SAMPLE_RATE = 48_000;
const CHANNELS = 2;

/** One decoded hit sample, a Float32Array per channel. */
export type HitSample = Float32Array[];

const WAV_HEADER_BYTES = 44;

function writeWavHeader(view: DataView, frames: number, sampleRate: number) {
	const bytesPerFrame = CHANNELS * 2;
	const dataBytes = frames * bytesPerFrame;
	const text = (offset: number, value: string) => {
		for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
	};
	text(0, "RIFF");
	view.setUint32(4, 36 + dataBytes, true);
	text(8, "WAVE");
	text(12, "fmt ");
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true); // PCM
	view.setUint16(22, CHANNELS, true);
	view.setUint32(24, sampleRate, true);
	view.setUint32(28, sampleRate * bytesPerFrame, true);
	view.setUint16(32, bytesPerFrame, true);
	view.setUint16(34, 16, true);
	text(36, "data");
	view.setUint32(40, dataBytes, true);
}

/**
 * Sums `hits` onto a silent bed of `durationSec` and returns it as a stereo 16-bit WAV. Mixed
 * straight into the file's own sample area: a take can be an hour long, and a float bed beside a
 * converted copy would cost several times the file's size for what is almost entirely silence.
 * Overlapping hits saturate instead of wrapping, and a hit that would run past the end is cut off.
 */
export function mixClickHitsToWav(
	hits: ClickHit[],
	samples: { down: HitSample; up: HitSample },
	durationSec: number,
	sampleRate = CLICK_SOUND_SAMPLE_RATE,
): ArrayBuffer {
	const frames = Math.max(1, Math.ceil(Math.max(0, durationSec) * sampleRate));
	const buffer = new ArrayBuffer(WAV_HEADER_BYTES + frames * CHANNELS * 2);
	writeWavHeader(new DataView(buffer), frames, sampleRate);
	// 44 is even, so the sample area is aligned for an Int16 view.
	const pcm = new Int16Array(buffer, WAV_HEADER_BYTES, frames * CHANNELS);
	for (const hit of hits) {
		if (!Number.isFinite(hit.timeSec) || hit.timeSec < 0) continue;
		const sample = hit.release ? samples.up : samples.down;
		const start = Math.round(hit.timeSec * sampleRate);
		for (let channel = 0; channel < CHANNELS; channel++) {
			// A mono sample plays on both sides.
			const source = sample[channel] ?? sample[0];
			if (!source) continue;
			const end = Math.min(frames, start + source.length);
			for (let frame = start; frame < end; frame++) {
				const index = frame * CHANNELS + channel;
				const value = pcm[index] + Math.round(source[frame - start] * hit.gain * 0x7fff);
				pcm[index] = value > 0x7fff ? 0x7fff : value < -0x8000 ? -0x8000 : value;
			}
		}
	}
	return buffer;
}

async function decodeHit(url: string): Promise<HitSample> {
	const response = await fetch(url);
	if (!response.ok) throw new Error(`Could not load the click sample ${url}`);
	const context = new OfflineAudioContext(CHANNELS, 1, CLICK_SOUND_SAMPLE_RATE);
	const decoded = await context.decodeAudioData(await response.arrayBuffer());
	return Array.from({ length: decoded.numberOfChannels }, (_, i) => decoded.getChannelData(i));
}

/**
 * The click track for `document` as WAV bytes, `durationSec` long, or null when the edit plays no
 * clicks. The level is the one the "mouse clicks" volume slider holds.
 */
export async function renderClickSoundWav(
	document: AxcutDocument,
	durationSec: number,
): Promise<ArrayBuffer | null> {
	const take = clickTakeOf(document);
	if (!take?.originalPath) return null;
	const gainDb = getEditorSettings(document).cursor.clickSoundGainDb;
	const cues = levelClickCues(await loadClickCues(take.originalPath), gainDb);
	const hits = placeClickHits(document, take, cues);
	if (hits.length === 0) return null;
	const urls = clickHitUrls();
	const [down, up] = await Promise.all([decodeHit(urls.down), decodeHit(urls.up)]);
	return mixClickHitsToWav(hits, { down, up }, durationSec);
}

// Click rings: the pulse drawn at each left-button press, as timeline regions.
//
// A click region is clip-anchored like a zoom (`clipId` + source seconds is the truth, `startMs` /
// `endMs` the ruler cache) and carries where the press landed as fractions of the SOURCE frame, the
// space the cursor sidecar is written in. The compositor draws the ring (`mode 20`), so the preview
// and the export share one implementation. Pure — no fs, no IPC.

import type { CursorTelemetryPoint } from "@/components/video-editor/types";
import { createId } from "./document/ids";
import type { AxcutClickEffects, AxcutClickRegion, AxcutClip, AxcutDocument } from "./schema";
import { STOP_CLICK_GUARD_MS } from "./timeline/zoom-suggestions";

export const CLICK_EFFECT_DEFAULTS = {
	show: true,
	color: "#ffffff",
	size: 1,
	opacity: 0.8,
	durationMs: 500,
} as const;

export type ResolvedClickEffects = Required<AxcutClickEffects>;

/** Bounds the inspector's sliders use, and a stored value is clamped to. */
export const CLICK_SIZE_RANGE = { min: 0.25, max: 4 } as const;
export const CLICK_DURATION_RANGE_MS = { min: 150, max: 2000 } as const;

/** The shortest ring worth drawing: below this the clip's end clipped it to a flash. */
const MIN_RING_MS = 60;

export function resolveClickEffects(
	document: Pick<AxcutDocument, "clickEffects"> | null | undefined,
): ResolvedClickEffects {
	const stored = document?.clickEffects;
	return {
		show: stored?.show ?? CLICK_EFFECT_DEFAULTS.show,
		color: stored?.color ?? CLICK_EFFECT_DEFAULTS.color,
		size: stored?.size ?? CLICK_EFFECT_DEFAULTS.size,
		opacity: stored?.opacity ?? CLICK_EFFECT_DEFAULTS.opacity,
		durationMs: stored?.durationMs ?? CLICK_EFFECT_DEFAULTS.durationMs,
	};
}

/** What one ring is drawn with: the region's own overrides over the project look. */
export function resolveClickStyle(
	effects: ResolvedClickEffects,
	region: Pick<AxcutClickRegion, "style">,
): { color: string; size: number; opacity: number } {
	return {
		color: region.style?.color ?? effects.color,
		size: region.style?.size ?? effects.size,
		opacity: region.style?.opacity ?? effects.opacity,
	};
}

/** Left button only: a double-click is two left presses; right and middle make no ring. */
export function isLeftClick(point: Pick<CursorTelemetryPoint, "interactionType">): boolean {
	return point.interactionType === "click" || point.interactionType === "double-click";
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * One ring per left click of each recording, on every clip that shows the moment: a clip replays
 * source time, so a click inside two clips' windows rings on both.
 *
 * `telemetryByAssetId` is each recording's samples in its own SOURCE time. The last
 * `STOP_CLICK_GUARD_MS` of a take is skipped: that click is the one that pressed Stop.
 */
export function buildClickRegions(
	clips: AxcutClip[],
	telemetryByAssetId: ReadonlyMap<string, CursorTelemetryPoint[]>,
	durationMs: number = CLICK_EFFECT_DEFAULTS.durationMs,
	makeId: (prefix: string) => string = createId,
): AxcutClickRegion[] {
	const regions: AxcutClickRegion[] = [];
	for (const clip of clips) {
		const samples = telemetryByAssetId.get(clip.assetId);
		const clipEndSec = clip.sourceEndSec ?? clip.sourceStartSec;
		if (!samples?.length || clipEndSec <= clip.sourceStartSec) continue;
		const lastMs = samples.reduce(
			(last, s) => (Number.isFinite(s.timeMs) ? Math.max(last, s.timeMs) : last),
			0,
		);
		for (const sample of samples) {
			if (!isLeftClick(sample) || !Number.isFinite(sample.timeMs)) continue;
			if (!Number.isFinite(sample.cx) || !Number.isFinite(sample.cy)) continue;
			if (sample.timeMs >= lastMs - STOP_CLICK_GUARD_MS) continue;
			const startSec = sample.timeMs / 1000;
			if (startSec < clip.sourceStartSec || startSec >= clipEndSec) continue;
			const endSec = Math.min(startSec + durationMs / 1000, clipEndSec);
			if ((endSec - startSec) * 1000 < MIN_RING_MS) continue;
			regions.push(clickRegionOnClip(clip, startSec, endSec, sample.cx, sample.cy, makeId));
		}
	}
	return separateOverlaps(regions, clips);
}

/**
 * Rings never overlap on the ruler (the same repel rule every region lane keeps), so a click that
 * follows another within a ring's length cuts the earlier ring short at the later press. A ring
 * left under `MIN_RING_MS` by that cut is dropped.
 */
function separateOverlaps(regions: AxcutClickRegion[], clips: AxcutClip[]): AxcutClickRegion[] {
	const sorted = [...regions].sort((a, b) => a.startMs - b.startMs);
	const clipById = new Map(clips.map((clip) => [clip.id, clip]));
	const out: AxcutClickRegion[] = [];
	sorted.forEach((region, i) => {
		const next = sorted[i + 1];
		if (!next || next.startMs >= region.endMs) {
			out.push(region);
			return;
		}
		if (next.startMs - region.startMs < MIN_RING_MS) return;
		const clip = region.clipId ? clipById.get(region.clipId) : undefined;
		const shortenedBySec = (region.endMs - next.startMs) / 1000;
		out.push({
			...region,
			endMs: next.startMs,
			sourceEndSec:
				region.sourceEndSec !== undefined && clip
					? region.sourceEndSec - shortenedBySec
					: region.sourceEndSec,
		});
	});
	return out;
}

/** A ring on `clip` from `startSec` to `endSec` of its source time. */
export function clickRegionOnClip(
	clip: AxcutClip,
	startSec: number,
	endSec: number,
	x: number,
	y: number,
	makeId: (prefix: string) => string = createId,
): AxcutClickRegion {
	// A raw clip is identity between its source time and its ruler time (see timelineMap).
	const rawStartSec = clip.timelineStartSec + (startSec - clip.sourceStartSec);
	const rawEndSec = clip.timelineStartSec + (endSec - clip.sourceStartSec);
	return {
		id: makeId("click"),
		clipId: clip.id,
		sourceStartSec: startSec,
		sourceEndSec: endSec,
		startMs: Math.round(rawStartSec * 1000),
		endMs: Math.round(rawEndSec * 1000),
		x: clamp01(x),
		y: clamp01(y),
	};
}

/** The clip under a ruler position, for a ring added by hand at the playhead. */
export function clipAtRawSec(clips: AxcutClip[], rawSec: number): AxcutClip | undefined {
	return clips.find((clip) => rawSec >= clip.timelineStartSec && rawSec < clip.timelineEndSec);
}

/** Where the recorded pointer was at `sourceSec`: the last sample at or before it. */
export function pointerAt(
	samples: ReadonlyArray<Pick<CursorTelemetryPoint, "timeMs" | "cx" | "cy">> | undefined,
	sourceSec: number,
): { x: number; y: number } | null {
	if (!samples?.length) return null;
	let best: (typeof samples)[number] | null = null;
	for (const sample of samples) {
		if (sample.timeMs / 1000 > sourceSec) continue;
		if (!best || sample.timeMs >= best.timeMs) best = sample;
	}
	return best ? { x: clamp01(best.cx), y: clamp01(best.cy) } : null;
}

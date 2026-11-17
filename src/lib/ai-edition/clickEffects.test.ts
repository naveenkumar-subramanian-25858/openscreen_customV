import { describe, expect, it } from "vitest";
import type { CursorTelemetryPoint } from "@/components/video-editor/types";
import {
	buildClickRegions,
	CLICK_EFFECT_DEFAULTS,
	clickRegionOnClip,
	isLeftClick,
	pointerAt,
	resolveClickEffects,
	resolveClickStyle,
} from "./clickEffects";
import { clearEditRegions, countEditRegions, removeRegion } from "./document/timeline";
import {
	type AxcutClip,
	type AxcutDocument,
	clickRegionSchema,
	createEmptyDocument,
} from "./schema";

const clip = (
	id: string,
	sourceStartSec: number,
	sourceEndSec: number,
	timelineStartSec: number,
): AxcutClip => ({
	id,
	assetId: "a1",
	sourceStartSec,
	sourceEndSec,
	timelineStartSec,
	timelineEndSec: timelineStartSec + (sourceEndSec - sourceStartSec),
	wordRefs: [],
	origin: "user",
	reason: "",
});

const sample = (
	timeMs: number,
	interactionType?: CursorTelemetryPoint["interactionType"],
	cx = 0.25,
	cy = 0.75,
): CursorTelemetryPoint => ({ timeMs, cx, cy, interactionType });

// A long tail sample so the stop-click guard never swallows the clicks under test.
const TAIL = sample(60_000, "move");
const ids = () => {
	let n = 0;
	return (prefix: string) => `${prefix}-${++n}`;
};
const build = (clips: AxcutClip[], samples: CursorTelemetryPoint[], durationMs?: number) =>
	buildClickRegions(clips, new Map([["a1", samples]]), durationMs, ids());

describe("isLeftClick", () => {
	it("takes left presses and double-clicks, nothing else", () => {
		expect(isLeftClick({ interactionType: "click" })).toBe(true);
		expect(isLeftClick({ interactionType: "double-click" })).toBe(true);
		for (const type of ["right-click", "middle-click", "mouseup", "move", undefined] as const) {
			expect(isLeftClick({ interactionType: type })).toBe(false);
		}
	});
});

describe("buildClickRegions", () => {
	it("makes one ring per left click, at the recorded point, and ignores other buttons", () => {
		const regions = build(
			[clip("c1", 0, 60, 0)],
			[sample(2000, "click"), sample(4000, "right-click"), sample(6000, "middle-click"), TAIL],
		);
		expect(regions).toHaveLength(1);
		expect(regions[0]).toMatchObject({
			clipId: "c1",
			sourceStartSec: 2,
			sourceEndSec: 2.5,
			startMs: 2000,
			endMs: 2500,
			x: 0.25,
			y: 0.75,
		});
	});

	it("keeps the ring's length to the requested duration", () => {
		const [region] = build([clip("c1", 0, 60, 0)], [sample(1000, "click"), TAIL], 800);
		expect(region.endMs - region.startMs).toBe(800);
	});

	it("places a click on the ruler through its clip, not on the recording's own clock", () => {
		// The clip shows source 10–20 s, laid at 100 s on the ruler.
		const regions = build(
			[clip("c1", 10, 20, 100)],
			[sample(5000, "click"), sample(12_000, "click"), sample(25_000, "click"), TAIL],
		);
		expect(regions).toHaveLength(1);
		expect(regions[0]).toMatchObject({ sourceStartSec: 12, startMs: 102_000, endMs: 102_500 });
	});

	it("rings on every clip that shows the moment", () => {
		const regions = build(
			[clip("c1", 0, 10, 0), clip("c2", 0, 10, 10)],
			[sample(3000, "click"), TAIL],
		);
		expect(regions.map((r) => [r.clipId, r.startMs])).toEqual([
			["c1", 3000],
			["c2", 13_000],
		]);
	});

	it("skips the click that pressed Stop", () => {
		const regions = build(
			[clip("c1", 0, 60, 0)],
			[sample(1000, "click"), sample(9500, "click"), sample(10_000, "move")],
		);
		expect(regions.map((r) => r.startMs)).toEqual([1000]);
	});

	it("cuts a ring short at the next press so rings never overlap", () => {
		const regions = build(
			[clip("c1", 0, 60, 0)],
			[sample(1000, "click"), sample(1200, "click"), sample(5000, "click"), TAIL],
		);
		expect(regions.map((r) => [r.startMs, r.endMs])).toEqual([
			[1000, 1200],
			[1200, 1700],
			[5000, 5500],
		]);
		expect(regions[0].sourceEndSec).toBeCloseTo(1.2);
	});

	it("does not end a ring past its clip", () => {
		const [region] = build([clip("c1", 0, 2.2, 0)], [sample(2000, "click"), TAIL]);
		expect(region.endMs).toBe(2200);
	});

	it("drops a click whose ring would be a flash", () => {
		expect(build([clip("c1", 0, 2.02, 0)], [sample(2000, "click"), TAIL])).toEqual([]);
	});

	it("ignores clips with no probed window and samples that are not numbers", () => {
		const unprobed: AxcutClip = { ...clip("c1", 0, 0, 0), sourceEndSec: undefined };
		expect(build([unprobed], [sample(1000, "click"), TAIL])).toEqual([]);
		expect(build([clip("c1", 0, 60, 0)], [sample(Number.NaN, "click"), TAIL])).toEqual([]);
	});

	it("produces regions the document schema accepts", () => {
		const regions = build([clip("c1", 0, 60, 0)], [sample(1000, "click"), TAIL]);
		expect(() => regions.forEach((r) => clickRegionSchema.parse(r))).not.toThrow();
	});
});

describe("pointerAt", () => {
	it("is the last sample at or before the time", () => {
		const samples = [sample(0, "move", 0.1, 0.1), sample(1000, "move", 0.5, 0.6)];
		expect(pointerAt(samples, 0.5)).toEqual({ x: 0.1, y: 0.1 });
		expect(pointerAt(samples, 1)).toEqual({ x: 0.5, y: 0.6 });
		expect(pointerAt([], 1)).toBeNull();
		expect(pointerAt(undefined, 1)).toBeNull();
	});
});

describe("click effect style", () => {
	it("falls back to the defaults, and a region's override wins over the project's", () => {
		expect(resolveClickEffects(null)).toEqual(CLICK_EFFECT_DEFAULTS);
		const effects = resolveClickEffects({ clickEffects: { color: "#112233", size: 2 } });
		expect(effects).toMatchObject({ color: "#112233", size: 2, opacity: 0.8, show: true });
		expect(resolveClickStyle(effects, {})).toEqual({ color: "#112233", size: 2, opacity: 0.8 });
		expect(resolveClickStyle(effects, { style: { size: 0.5 } })).toEqual({
			color: "#112233",
			size: 0.5,
			opacity: 0.8,
		});
	});
});

describe("click regions in the document", () => {
	const withClicks = (): AxcutDocument => {
		const doc = createEmptyDocument({ projectId: "p1", title: "t" });
		const c = clip("c1", 0, 60, 0);
		return {
			...doc,
			timeline: { ...doc.timeline, clips: [c] },
			clickRegions: [
				clickRegionOnClip(c, 1, 1.5, 0.1, 0.2, () => "k1"),
				clickRegionOnClip(c, 3, 3.5, 0.3, 0.4, () => "k2"),
			],
		};
	};

	it("deletes one region and leaves the rest", () => {
		const next = removeRegion(withClicks(), "click", "k1");
		expect(next.clickRegions?.map((r) => r.id)).toEqual(["k2"]);
	});

	it("counts toward Clear timeline, which empties them to [] so they are not re-seeded", () => {
		const doc = withClicks();
		expect(countEditRegions(doc)).toBe(2);
		expect(clearEditRegions(doc).clickRegions).toEqual([]);
	});

	it("leaves an unseeded list unseeded", () => {
		const doc = createEmptyDocument({ projectId: "p1", title: "t" });
		expect(doc.clickRegions).toBeUndefined();
		expect(clearEditRegions(doc).clickRegions).toBeUndefined();
	});
});

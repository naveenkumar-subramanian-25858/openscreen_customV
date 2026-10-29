import { describe, expect, it } from "vitest";
import {
	applyRatio,
	moveRect,
	normalizeCaptureRegion,
	ratioPartsOf,
	ratioStep,
	regionFrameBounds,
	resizeRect,
	setRectSize,
	snapToRatioGrid,
	toEvenPixelRect,
	toNormalizedRegion,
} from "./regionUtils";

const bounds = { width: 2880, height: 1800 };

describe("regionUtils", () => {
	it("rounds to even device pixels inside the display", () => {
		const rect = toEvenPixelRect({ x: 2879.6, y: 10.2, width: 501.7, height: 333.1 }, bounds);
		expect(rect.width % 2).toBe(0);
		expect(rect.height % 2).toBe(0);
		expect(rect.x + rect.width).toBeLessThanOrEqual(bounds.width);
	});

	it("normalizes to display fractions", () => {
		expect(toNormalizedRegion({ x: 720, y: 450, width: 1440, height: 900 }, bounds)).toEqual({
			x: 0.25,
			y: 0.25,
			width: 0.5,
			height: 0.5,
		});
	});

	it("keeps moved rects on the display", () => {
		const moved = moveRect({ x: 100, y: 100, width: 400, height: 300 }, -500, 5000, bounds);
		expect(moved).toEqual({ x: 0, y: 1500, width: 400, height: 300 });
	});

	it("fits a preset ratio around the centre", () => {
		const rect = applyRatio({ x: 500, y: 500, width: 800, height: 800 }, 16 / 9, bounds);
		expect(rect.width / rect.height).toBeCloseTo(16 / 9, 5);
		expect(rect.x + rect.width / 2).toBeCloseTo(900, 5);
	});

	it("resizes with a locked ratio from a corner", () => {
		const start = { x: 200, y: 200, width: 800, height: 450 };
		const rect = resizeRect(start, "se", 160, 0, bounds, 16 / 9);
		expect(rect.x).toBe(200);
		expect(rect.y).toBe(200);
		expect(rect.width / rect.height).toBeCloseTo(16 / 9, 5);
		expect(rect.width).toBeCloseTo(960, 5);
	});

	it("derives the other side from the ratio when setting exact size", () => {
		const rect = setRectSize(
			{ x: 0, y: 0, width: 800, height: 450 },
			{ width: 1280 },
			bounds,
			16 / 9,
		);
		expect(rect.height).toBeCloseTo(720, 5);
	});

	it("keeps a locked ratio at the smallest size instead of flooring both sides", () => {
		const start = { x: 200, y: 200, width: 800, height: 450 };
		const rect = resizeRect(start, "se", -2000, -2000, bounds, 16 / 9);
		expect(rect.width / rect.height).toBeCloseTo(16 / 9, 5);
		expect(Math.min(rect.width, rect.height)).toBeGreaterThanOrEqual(64);
		const fitted = applyRatio({ x: 0, y: 0, width: 70, height: 70 }, 9 / 16, bounds);
		expect(fitted.width / fitted.height).toBeCloseTo(9 / 16, 5);
	});

	it("never accepts a region with no area", () => {
		const edge = normalizeCaptureRegion({ x: 1, y: 1, width: 0.5, height: 0.5 });
		expect(edge?.width).toBeGreaterThan(0);
		expect(edge?.height).toBeGreaterThan(0);
	});

	it("rejects invalid capture regions and clamps valid ones", () => {
		expect(normalizeCaptureRegion({ x: "a" })).toBeNull();
		expect(normalizeCaptureRegion({ x: 0.9, y: 0, width: 0.5, height: 1 })).toEqual({
			x: 0.9,
			y: 0,
			width: expect.closeTo(0.1, 5),
			height: 1,
		});
	});
});

describe("exact-ratio snapping", () => {
	it("reduces a ratio to whole numbers", () => {
		expect(ratioPartsOf(16, 9)).toEqual({ w: 16, h: 9 });
		expect(ratioPartsOf(1920, 1080)).toEqual({ w: 16, h: 9 });
		expect(ratioPartsOf(1.85, 1)).toEqual({ w: 37, h: 20 });
		expect(ratioPartsOf(0, 9)).toBeNull();
		expect(ratioPartsOf(Number.NaN, 9)).toBeNull();
	});

	it("steps in whole even multiples", () => {
		expect(ratioStep({ w: 16, h: 9 })).toEqual({ stepW: 32, stepH: 18 });
		expect(ratioStep({ w: 1, h: 1 })).toEqual({ stepW: 2, stepH: 2 });
	});

	it("lands exactly on the ratio, with even sides, for every preset", () => {
		const presets: Array<[number, number]> = [
			[16, 9],
			[9, 16],
			[1, 1],
			[4, 3],
			[4, 5],
			[21, 9],
		];
		for (const [w, h] of presets) {
			const parts = ratioPartsOf(w, h);
			if (!parts) throw new Error("preset");
			// The 1000x563 box a 16:9 drag typically ends on.
			const rect = snapToRatioGrid({ x: 400.4, y: 300.7, width: 1000, height: 563 }, parts, bounds);
			expect(rect.width * h).toBe(rect.height * w);
			expect(rect.width % 2).toBe(0);
			expect(rect.height % 2).toBe(0);
			expect(rect.x + rect.width).toBeLessThanOrEqual(bounds.width);
			expect(rect.y + rect.height).toBeLessThanOrEqual(bounds.height);
		}
	});

	it("keeps the centre and stays on the display", () => {
		const parts = ratioPartsOf(16, 9);
		if (!parts) throw new Error("ratio");
		const rect = snapToRatioGrid({ x: 2800, y: 1700, width: 600, height: 337 }, parts, bounds);
		expect(rect.x + rect.width).toBeLessThanOrEqual(bounds.width);
		expect(rect.y + rect.height).toBeLessThanOrEqual(bounds.height);
	});
});

describe("regionFrameBounds", () => {
	const display = { x: 0, y: 0, width: 1728, height: 1117 };

	it("is the part of the display a region take records, in display coordinates", () => {
		expect(regionFrameBounds(display, { x: 0.25, y: 0.25, width: 0.5, height: 0.5 })).toEqual({
			x: 432,
			y: 279.25,
			width: 864,
			height: 558.5,
		});
	});

	it("places a cursor inside the region where it really is, not where the display puts it", () => {
		const frame = regionFrameBounds(display, { x: 0.1, y: 0.1, width: 0.8, height: 0.8 });
		const cursor = { x: 300, y: 200 }; // display points
		const inFrame = (cursor.y - frame.y) / frame.height;
		const inDisplay = (cursor.y - display.y) / display.height;
		// Normalised against the whole display the cursor would sit this much too low.
		expect(inDisplay - inFrame).toBeGreaterThan(0.05);
		expect(inFrame).toBeCloseTo((200 - 111.7) / 893.6, 5);
	});

	it("keeps the display's own origin (a second monitor)", () => {
		const second = { x: 1728, y: -200, width: 1920, height: 1080 };
		const frame = regionFrameBounds(second, { x: 0.5, y: 0, width: 0.5, height: 0.5 });
		expect(frame).toEqual({ x: 2688, y: -200, width: 960, height: 540 });
	});
});

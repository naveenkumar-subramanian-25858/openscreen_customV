import { describe, expect, it } from "vitest";
import {
	cropDraftFromRegion,
	PREVIEW_MAX_HEIGHT_PX,
	previewBoxStyle,
	snapCropToPixels,
} from "./cropDraft";

describe("crop draft helpers", () => {
	it("gives the preview box the video's own aspect ratio", () => {
		// The overlay and every drag are measured against the box while the
		// video letterboxes inside it — any box/video aspect mismatch shifts
		// the crop off the pixels it claims to select.
		for (const aspect of [16 / 9, 784 / 1082, 21 / 9]) {
			const style = previewBoxStyle(aspect);
			expect(style.aspectRatio).toBe(`${aspect}`);
			// Width is derived from the height cap so a clamped height can
			// never silently break the ratio (CSS keeps width and drops the
			// ratio when max-height wins).
			expect(style.width).toBe(`min(100%, calc(${PREVIEW_MAX_HEIGHT_PX}px * ${aspect}))`);
		}
	});

	it("falls back to 16:9 while the video metadata has not loaded", () => {
		for (const bogus of [0, -3, Number.NaN, Number.POSITIVE_INFINITY]) {
			expect(previewBoxStyle(bogus).aspectRatio).toBe(`${16 / 9}`);
		}
	});

	it("stores the draft as unrounded fractions", () => {
		const draft = cropDraftFromRegion({ x: 1 / 3, y: 0.1, width: 0.5, height: 0.8 });
		expect(draft.x).toBe(1 / 3);
		expect(draft.x).not.toBe(33);
	});
});

describe("snapCropToPixels", () => {
	const video = { width: 3072, height: 1922 };
	const px = (c: { x: number; y: number; width: number; height: number }) => ({
		x: Math.round(c.x * video.width),
		y: Math.round(c.y * video.height),
		w: Math.round(c.width * video.width),
		h: Math.round(c.height * video.height),
	});

	it("turns a fractional 17:10 fit into the exact 3060x1800 pixels", () => {
		// What the ratio field stored: full width, 3072x1807.07 of the frame.
		const fit = { x: 0, y: 0.05980290138948405, width: 1, height: 0.9401970986105159 };
		const out = px(snapCropToPixels(fit, video, 1.7));
		expect(out.w).toBe(3060);
		expect(out.h).toBe(1800);
		expect(out.x).toBe(6);
	});

	it("keeps the crop inside the frame", () => {
		const edge = { x: 0.5, y: 0.5, width: 0.5, height: 0.5 };
		const out = snapCropToPixels(edge, video, 16 / 9);
		expect(out.x + out.width).toBeLessThanOrEqual(1 + 1e-9);
		expect(out.y + out.height).toBeLessThanOrEqual(1 + 1e-9);
	});

	it("rounds a free crop to even whole pixels", () => {
		const out = px(snapCropToPixels({ x: 0.1, y: 0.1, width: 0.5, height: 0.3333 }, video, null));
		expect(out.w % 2).toBe(0);
		expect(out.h % 2).toBe(0);
	});

	it("leaves a full-frame crop whole", () => {
		expect(snapCropToPixels({ x: 0, y: 0, width: 1, height: 1 }, video, null)).toEqual({
			x: 0,
			y: 0,
			width: 1,
			height: 1,
		});
	});
});

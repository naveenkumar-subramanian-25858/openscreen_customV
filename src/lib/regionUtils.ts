export interface PixelRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface RegionBounds {
	width: number;
	height: number;
}

export type ResizeHandle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

export const MIN_REGION_SIZE = 64;

export const RATIO_PRESETS = [
	{ label: "16:9", w: 16, h: 9 },
	{ label: "9:16", w: 9, h: 16 },
	{ label: "1:1", w: 1, h: 1 },
	{ label: "4:3", w: 4, h: 3 },
	{ label: "4:5", w: 4, h: 5 },
] as const;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const even = (value: number) => Math.floor(value / 2) * 2;

/** Normalises a drag between two points (any direction) into a rect. */
export function rectFromPoints(ax: number, ay: number, bx: number, by: number): PixelRect {
	return {
		x: Math.min(ax, bx),
		y: Math.min(ay, by),
		width: Math.abs(bx - ax),
		height: Math.abs(by - ay),
	};
}

/**
 * The smallest width/height a ratio-locked box may have: MIN_REGION_SIZE on its short side, the
 * other side following the ratio. Flooring both sides at MIN_REGION_SIZE instead would turn a
 * 16:9 box at its smallest into a square while the lock still reads 16:9.
 */
function minimumSize(ratio?: number) {
	if (!ratio) return { minW: MIN_REGION_SIZE, minH: MIN_REGION_SIZE };
	return ratio >= 1
		? { minW: MIN_REGION_SIZE * ratio, minH: MIN_REGION_SIZE }
		: { minW: MIN_REGION_SIZE, minH: MIN_REGION_SIZE / ratio };
}

/** Keeps a rect inside the display, shrinking it first if it is too large. */
export function clampRect(
	rect: PixelRect,
	bounds: RegionBounds,
	minW = MIN_REGION_SIZE,
	minH = MIN_REGION_SIZE,
): PixelRect {
	const width = clamp(rect.width, Math.min(minW, bounds.width), bounds.width);
	const height = clamp(rect.height, Math.min(minH, bounds.height), bounds.height);
	return {
		x: clamp(rect.x, 0, bounds.width - width),
		y: clamp(rect.y, 0, bounds.height - height),
		width,
		height,
	};
}

export function moveRect(rect: PixelRect, dx: number, dy: number, bounds: RegionBounds): PixelRect {
	return clampRect({ ...rect, x: rect.x + dx, y: rect.y + dy }, bounds);
}

/**
 * Resizes by dragging a handle. With a ratio, the dragged corner/edge drives the
 * size and the other dimension follows, anchored on the opposite side.
 */
export function resizeRect(
	rect: PixelRect,
	handle: ResizeHandle,
	dx: number,
	dy: number,
	bounds: RegionBounds,
	ratio?: number,
): PixelRect {
	const { minW, minH } = minimumSize(ratio);
	let left = rect.x;
	let top = rect.y;
	let right = rect.x + rect.width;
	let bottom = rect.y + rect.height;

	if (handle.includes("w")) left = clamp(left + dx, 0, right - minW);
	if (handle.includes("e")) right = clamp(right + dx, left + minW, bounds.width);
	if (handle.includes("n")) top = clamp(top + dy, 0, bottom - minH);
	if (handle.includes("s")) bottom = clamp(bottom + dy, top + minH, bounds.height);

	if (!ratio) {
		return { x: left, y: top, width: right - left, height: bottom - top };
	}

	const movesX = handle.includes("w") || handle.includes("e");
	const movesY = handle.includes("n") || handle.includes("s");
	const anchorLeft = !handle.includes("w");
	const anchorTop = !handle.includes("n");

	// Room available from the anchor to the display edge in each direction.
	const maxWidth = anchorLeft ? bounds.width - left : right;
	const maxHeight = anchorTop ? bounds.height - top : bottom;

	let width = right - left;
	let height = bottom - top;
	if (movesX && !movesY) {
		height = width / ratio;
	} else if (movesY && !movesX) {
		width = height * ratio;
	} else if (width / ratio > height) {
		height = width / ratio;
	} else {
		width = height * ratio;
	}

	const scale = Math.min(1, maxWidth / width, maxHeight / height);
	width *= scale;
	height *= scale;

	// Edge handles resize around the box centre on the free axis.
	const x = movesX ? (anchorLeft ? left : right - width) : rect.x + (rect.width - width) / 2;
	const y = movesY ? (anchorTop ? top : bottom - height) : rect.y + (rect.height - height) / 2;
	return clampRect({ x, y, width, height }, bounds, minW, minH);
}

/**
 * Re-fits a rect to a ratio around its centre, using as much of the current rect
 * as fits inside the display.
 */
export function applyRatio(rect: PixelRect, ratio: number, bounds: RegionBounds): PixelRect {
	const centerX = rect.x + rect.width / 2;
	const centerY = rect.y + rect.height / 2;
	let width = rect.width;
	let height = width / ratio;
	if (height > rect.height) {
		height = rect.height;
		width = height * ratio;
	}
	const scale = Math.min(1, bounds.width / width, bounds.height / height);
	width *= scale;
	height *= scale;
	const { minW, minH } = minimumSize(ratio);
	return clampRect(
		{ x: centerX - width / 2, y: centerY - height / 2, width, height },
		bounds,
		minW,
		minH,
	);
}

/** Sets an exact size (px), optionally deriving the other side from the ratio. */
export function setRectSize(
	rect: PixelRect,
	size: { width?: number; height?: number },
	bounds: RegionBounds,
	ratio?: number,
): PixelRect {
	let width = size.width ?? rect.width;
	let height = size.height ?? rect.height;
	if (ratio) {
		if (size.width !== undefined) height = width / ratio;
		else if (size.height !== undefined) width = height * ratio;
	}
	const { minW, minH } = minimumSize(ratio);
	width = clamp(width, minW, bounds.width);
	height = clamp(height, minH, bounds.height);
	if (ratio) {
		const scale = Math.min(1, bounds.width / width, bounds.height / height);
		width *= scale;
		height *= scale;
	}
	return clampRect({ ...rect, width, height }, bounds, minW, minH);
}

/** Rounds to whole device pixels with even width/height (required by H.264). */
export function toEvenPixelRect(rect: PixelRect, bounds: RegionBounds): PixelRect {
	const width = Math.max(2, even(Math.round(rect.width)));
	const height = Math.max(2, even(Math.round(rect.height)));
	return {
		x: clamp(Math.round(rect.x), 0, Math.max(0, bounds.width - width)),
		y: clamp(Math.round(rect.y), 0, Math.max(0, bounds.height - height)),
		width,
		height,
	};
}

/** Device-pixel rect → fractions of the display (resolution independent). */
export function toNormalizedRegion(rect: PixelRect, bounds: RegionBounds): PixelRect {
	return {
		x: rect.x / bounds.width,
		y: rect.y / bounds.height,
		width: rect.width / bounds.width,
		height: rect.height / bounds.height,
	};
}

/** Parses a fractional region from untrusted input; returns null if unusable. */
/**
 * The part of a display (in its own coordinates) that a region take records. A cursor sample is
 * normalised against the frame that was recorded, so for a take cropped at capture this is the
 * rect to use, not the whole display's bounds.
 */
export function regionFrameBounds(
	display: { x: number; y: number; width: number; height: number },
	region: { x: number; y: number; width: number; height: number },
) {
	return {
		x: display.x + region.x * display.width,
		y: display.y + region.y * display.height,
		width: region.width * display.width,
		height: region.height * display.height,
	};
}

export function normalizeCaptureRegion(candidate: unknown): PixelRect | null {
	if (!candidate || typeof candidate !== "object") return null;
	const raw = candidate as Partial<PixelRect>;
	const { x, y, width, height } = raw;
	if (
		typeof x !== "number" ||
		typeof y !== "number" ||
		typeof width !== "number" ||
		typeof height !== "number" ||
		![x, y, width, height].every(Number.isFinite)
	) {
		return null;
	}
	// An origin on the far edge would leave no room for a size at all.
	const nx = clamp(x, 0, 0.99);
	const ny = clamp(y, 0, 0.99);
	const nw = clamp(width, 0.01, 1 - nx);
	const nh = clamp(height, 0.01, 1 - ny);
	return { x: nx, y: ny, width: nw, height: nh };
}

export interface RatioParts {
	w: number;
	h: number;
}

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

/**
 * A ratio as the smallest whole numbers, so 16:9 stays 16:9 and 1.85:1 becomes 37:20. Null for
 * anything that is not a usable ratio.
 */
export function ratioPartsOf(w: number, h: number): RatioParts | null {
	if (!(w > 0) || !(h > 0) || !Number.isFinite(w) || !Number.isFinite(h)) return null;
	// Two decimals are enough for any ratio a person types, and keep the numbers whole.
	const a = Math.round(w * 100);
	const b = Math.round(h * 100);
	if (a < 1 || b < 1) return null;
	const g = gcd(a, b);
	return { w: a / g, h: b / g };
}

/**
 * The sizes that hit a ratio exactly with both sides even (H.264 needs even sides): whole
 * multiples of 2w x 2h. Rounding an odd side down instead (1000x563 -> 1000x562) is what made a
 * recorded region come out a little off the ratio it was set to.
 */
export function ratioStep(ratio: RatioParts): { stepW: number; stepH: number } {
	return { stepW: ratio.w * 2, stepH: ratio.h * 2 };
}

/**
 * Snaps a box to the nearest exact-ratio size that fits the display, keeping its centre. When
 * even the smallest exact size does not fit the display it is returned as it was.
 */
export function snapToRatioGrid(
	rect: PixelRect,
	ratio: RatioParts,
	bounds: RegionBounds,
): PixelRect {
	const { stepW, stepH } = ratioStep(ratio);
	const maxN = Math.floor(Math.min(bounds.width / stepW, bounds.height / stepH));
	if (maxN < 1) return rect;
	const minN = Math.min(maxN, Math.ceil(MIN_REGION_SIZE / Math.min(stepW, stepH)));
	const n = clamp(Math.round(rect.width / stepW), minN, maxN);
	const width = n * stepW;
	const height = n * stepH;
	const x = clamp(Math.round(rect.x + (rect.width - width) / 2), 0, bounds.width - width);
	const y = clamp(Math.round(rect.y + (rect.height - height) / 2), 0, bounds.height - height);
	return { x, y, width, height };
}

// Pure crop-draft helpers for Edit Clip. The modal stores the rectangle as
// frame fractions (0–1), not rounded integer percents.

export interface CropDraft {
	x: number;
	y: number;
	width: number;
	height: number;
}

export function cropDraftFromRegion(region: CropDraft): CropDraft {
	return { x: region.x, y: region.y, width: region.width, height: region.height };
}

export function cropDraftToPct(draft: CropDraft): { x: number; y: number; w: number; h: number } {
	return {
		x: draft.x * 100,
		y: draft.y * 100,
		w: draft.width * 100,
		h: draft.height * 100,
	};
}

export const PREVIEW_MAX_HEIGHT_PX = 360;

/**
 * Preview box for the crop overlay. The crop rectangle and every drag are
 * measured against THIS element, while the <video> inside it letterboxes via
 * object-fit: contain — so the box must have the video's own aspect ratio or
 * the overlay drifts off the pixels it claims to crop (the old fixed
 * 409x230 box was 16:9 for exactly this reason). Width is therefore derived
 * from the height cap and the aspect: `min(100%, height-cap * aspect)`.
 * Declaring width this way — rather than `width: 100%` plus a max-height —
 * matters because when a max-height clamps an aspect-ratio box, CSS keeps
 * the width and BREAKS the ratio, which would letterbox portrait sources
 * all over again.
 */
export function previewBoxStyle(videoAspectRatio: number): {
	position: "relative";
	width: string;
	aspectRatio: string;
	margin: string;
	flexShrink: number;
	background: string;
	borderRadius: string;
	border: string;
	overflow: "hidden";
} {
	const aspect =
		Number.isFinite(videoAspectRatio) && videoAspectRatio > 0 ? videoAspectRatio : 16 / 9;
	return {
		position: "relative",
		width: `min(100%, calc(${PREVIEW_MAX_HEIGHT_PX}px * ${aspect}))`,
		aspectRatio: `${aspect}`,
		margin: "0 auto 14px",
		flexShrink: 0,
		background: "#0a0b0e",
		borderRadius: "var(--r-md)",
		border: "1px solid var(--border)",
		overflow: "hidden",
	};
}

/** `ratio` as the smallest whole W:H that reproduces it (17/10 -> 17:10), or null for none. */
function wholeRatio(ratio: number): { w: number; h: number } | null {
	for (let h = 1; h <= 100; h++) {
		const w = Math.round(ratio * h);
		if (w > 0 && Math.abs(w / h - ratio) < 1e-6 * ratio) return { w, h };
	}
	return null;
}

/**
 * Snaps a crop (frame fractions) to whole, even source pixels so the clip's size is exactly what
 * the crop says, not a rounding of it. Left as fractions, a 17:10 crop of a 3072x1922 frame is
 * 3072x1807.07: the export then rounds that to 3072x1806, a shape that is no longer 17:10. With a
 * `ratio` the result is the largest whole-pixel rectangle of exactly that ratio inside the crop
 * (3060x1800); without one it is the crop rounded to even pixels. Centred on the original crop.
 */
export function snapCropToPixels(
	crop: CropDraft,
	video: { width: number; height: number },
	ratio: number | null,
): CropDraft {
	if (!(video.width > 0) || !(video.height > 0)) return crop;
	const boxW = crop.width * video.width;
	const boxH = crop.height * video.height;
	let pxW: number;
	let pxH: number;
	const whole = ratio ? wholeRatio(ratio) : null;
	if (whole) {
		// Both sides must be even for 4:2:0 video, so a ratio with an odd side steps twice as far.
		const step = whole.w % 2 === 1 || whole.h % 2 === 1 ? 2 : 1;
		const n = Math.floor(Math.min(boxW / (whole.w * step), boxH / (whole.h * step)) + 1e-9);
		if (n < 1) return crop;
		pxW = whole.w * step * n;
		pxH = whole.h * step * n;
	} else {
		pxW = Math.min(video.width, Math.max(2, Math.round(boxW / 2) * 2));
		pxH = Math.min(video.height, Math.max(2, Math.round(boxH / 2) * 2));
	}
	const left = Math.min(
		video.width - pxW,
		Math.max(0, Math.round((crop.x + crop.width / 2) * video.width - pxW / 2)),
	);
	const top = Math.min(
		video.height - pxH,
		Math.max(0, Math.round((crop.y + crop.height / 2) * video.height - pxH / 2)),
	);
	return {
		x: left / video.width,
		y: top / video.height,
		width: pxW / video.width,
		height: pxH / video.height,
	};
}

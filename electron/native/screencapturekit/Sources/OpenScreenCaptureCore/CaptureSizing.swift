import CoreGraphics
import Foundation

/// How big the ScreenCaptureKit output buffer has to be, given the content the stream will
/// actually rasterise.
///
/// # Why this is not "the size of the display"
///
/// `SCStreamConfiguration.width`/`height` are **pixels**, and ScreenCaptureKit will not
/// enlarge a smaller source to fill them. `scalesToFit` defaults to `false`, and the SDK
/// header is explicit about what that means: *"When true, the output scales up and down. When
/// false, the output only scales down."* Configure a buffer bigger than the source and the
/// frame is drawn at its native size in one corner of it, with the background — black —
/// everywhere else. The recording is then a small picture inside a large black rectangle, at
/// full file resolution, for its entire duration (issue #418).
///
/// The size the stream rasterises is a property of the `SCContentFilter`: its `contentRect`
/// (points) times its `pointPixelScale`. That product is the only correct value for
/// `width`/`height`. A display size read from CoreGraphics is not: `CGDisplayPixelsWide` is
/// documented in "pixel units" but tracks the display *mode*, so on a Retina Mac it can report
/// a number that is neither what the filter measures nor what the stream draws — and nothing
/// downstream reconciles the two. On a 1× display the two agree, which is exactly why this
/// only ever showed up on HiDPI machines.
///
/// # Why the cap is proportional
///
/// The caller carries a ceiling (the app asks for at most 4K). Clamping each axis on its own
/// changes the *shape* of the buffer, and a buffer whose aspect ratio differs from the source
/// hits the same wall from the other side: `scalesToFit == false` still scales down, but it
/// preserves aspect, so the surplus becomes black bars. A 5120×1440 ultrawide capped to
/// 3840×1440 per axis is drawn as 3840×1080 with 180 black rows above and below it. Scaling
/// both axes by one factor keeps the buffer the same shape as the source, so the downscale
/// fills it.
///
/// - Parameters:
///   - contentSize: `SCContentFilter.contentRect.size` — the captured region, in points.
///   - pointPixelScale: `SCContentFilter.pointPixelScale` — points-to-pixels for that region.
///   - maxWidth: Ceiling for the returned width, in pixels.
///   - maxHeight: Ceiling for the returned height, in pixels.
/// - Returns: Even, positive pixel dimensions with the source's aspect ratio.
public func captureOutputSize(
	contentSize: CGSize,
	pointPixelScale: CGFloat,
	maxWidth: Int,
	maxHeight: Int
) -> (width: Int, height: Int) {
	// The ceiling is the one value we can never exceed, so it is also the only sane answer for
	// a filter that reports nothing usable — better a correctly-shaped guess than a buffer the
	// stream will corner its frame into.
	let ceilingWidth = evenFloor(max(2, maxWidth))
	let ceilingHeight = evenFloor(max(2, maxHeight))

	let scale = pointPixelScale.isFinite && pointPixelScale > 0 ? pointPixelScale : 1
	let pixelWidth = contentSize.width.isFinite ? contentSize.width * scale : 0
	let pixelHeight = contentSize.height.isFinite ? contentSize.height * scale : 0
	guard pixelWidth >= 1, pixelHeight >= 1 else {
		return (ceilingWidth, ceilingHeight)
	}

	// One factor for both axes: see the note above on why a per-axis clamp reintroduces the
	// very padding this function exists to remove.
	let fit = min(1, min(CGFloat(ceilingWidth) / pixelWidth, CGFloat(ceilingHeight) / pixelHeight))
	return (
		evenFloor(Int((pixelWidth * fit).rounded())),
		evenFloor(Int((pixelHeight * fit).rounded()))
	)
}

/// The part of a display a region take records, as ScreenCaptureKit wants it: a `sourceRect` in
/// points and an output size in pixels that is the region's own pixel size, so the stream
/// crops at capture and scales nothing. HiDPI is why this works in pixels first: the region is
/// whole device pixels (even-sized for the encoder), and the point rect is that count divided
/// by the scale, so a 2x display gives the 2x pixels it has.
///
/// - Parameters:
///   - contentSize: the display's size in points.
///   - pointPixelScale: points-to-pixels for it.
///   - crop: the region as 0...1 fractions of the display, origin top-left.
public func regionCaptureRect(
	contentSize: CGSize,
	pointPixelScale: CGFloat,
	crop: CGRect
) -> (rect: CGRect, width: Int, height: Int)? {
	let scale = pointPixelScale.isFinite && pointPixelScale > 0 ? pointPixelScale : 1
	let fullWidth = (contentSize.width * scale).rounded()
	let fullHeight = (contentSize.height * scale).rounded()
	guard fullWidth >= 2, fullHeight >= 2, crop.width > 0, crop.height > 0 else {
		return nil
	}
	let width = min(evenFloor(Int((crop.width * fullWidth).rounded())), evenFloor(Int(fullWidth)))
	let height = min(evenFloor(Int((crop.height * fullHeight).rounded())), evenFloor(Int(fullHeight)))
	let x = min(max(0, (crop.minX * fullWidth).rounded()), fullWidth - CGFloat(width))
	let y = min(max(0, (crop.minY * fullHeight).rounded()), fullHeight - CGFloat(height))
	return (
		CGRect(x: x / scale, y: y / scale, width: CGFloat(width) / scale, height: CGFloat(height) / scale),
		width,
		height
	)
}

/// Nearest even value at or below `value`, floored at 2 — H.264 chroma subsampling needs both
/// dimensions even, and the encoder rejects zero.
private func evenFloor(_ value: Int) -> Int {
	let clamped = max(2, value)
	return clamped - (clamped % 2)
}

/// The video bitrate for the size the stream actually got: 0.2 bit per pixel per frame, about
/// 25 Mbit/s at 1920×1080/60 and 100 Mbit/s at 4K/60, kept between 2 and 100 Mbit/s. The old
/// 0.1 (the Linux helper's rule) blocked fine text and UI edges; screen content is mostly
/// sharp edges, which H.264 spends bits on.
///
/// The renderer used to send `computeBitrate(TARGET_WIDTH, TARGET_HEIGHT)`, the 4K ceiling with
/// its high-frame-rate boost: 76.5 Mbit/s for every take, a 1080p one included, 4.25× what
/// Windows spends on the same capture (getopenscreen/openscreen#924). It cannot know the real
/// size, which `captureOutputSize` settles here, so it now sends none.
public func defaultVideoBitrate(width: Int, height: Int, fps: Int) -> Int {
	let bitsPerPixel = 0.2
	let pixelsPerSecond = Double(max(1, width)) * Double(max(1, height)) * Double(max(1, fps))
	return min(max(Int(pixelsPerSecond * bitsPerPixel), 2_000_000), 100_000_000)
}

/// The H.264 keyframe interval, in frames: one second of video, the interval Windows uses.
/// Left to VideoToolbox it had no bound, and the editor's scrub cost is the GOP length: a
/// seek decodes from the keyframe before it (getopenscreen/openscreen#937).
public func videoKeyFrameInterval(fps: Int) -> Int {
	max(1, fps)
}

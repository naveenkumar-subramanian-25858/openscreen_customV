import { useCallback, useEffect, useRef, useState } from "react";
import { MdLock, MdLockOpen } from "react-icons/md";
import { useScopedT } from "@/contexts/I18nContext";
import {
	applyRatio,
	clampRect,
	MIN_REGION_SIZE,
	moveRect,
	type PixelRect,
	RATIO_PRESETS,
	type RatioParts,
	type RegionBounds,
	type ResizeHandle,
	ratioPartsOf,
	resizeRect,
	setRectSize,
	snapToRatioGrid,
	toEvenPixelRect,
} from "@/lib/regionUtils";

type DragState =
	| { mode: "create"; startX: number; startY: number }
	| { mode: "move"; startX: number; startY: number; origin: PixelRect }
	| { mode: "resize"; handle: ResizeHandle; startX: number; startY: number; origin: PixelRect };

const HANDLES: { handle: ResizeHandle; style: React.CSSProperties; cursor: string }[] = [
	{ handle: "nw", style: { left: 0, top: 0 }, cursor: "nwse-resize" },
	{ handle: "n", style: { left: "50%", top: 0 }, cursor: "ns-resize" },
	{ handle: "ne", style: { left: "100%", top: 0 }, cursor: "nesw-resize" },
	{ handle: "e", style: { left: "100%", top: "50%" }, cursor: "ew-resize" },
	{ handle: "se", style: { left: "100%", top: "100%" }, cursor: "nwse-resize" },
	{ handle: "s", style: { left: "50%", top: "100%" }, cursor: "ns-resize" },
	{ handle: "sw", style: { left: 0, top: "100%" }, cursor: "nesw-resize" },
	{ handle: "w", style: { left: 0, top: "50%" }, cursor: "ew-resize" },
];

const TOOLBAR_HEIGHT = 44;
const TOOLBAR_GAP = 10;

const inputClass =
	"h-6 w-12 rounded-md border border-white/10 bg-white/[0.06] px-1 text-center text-[11px] text-white outline-none focus:border-[#34B27B] tabular-nums";

const DEFAULT_RATIO = { w: 17, h: 10 };

export function RegionSelector() {
	const t = useScopedT("launch");
	const tc = useScopedT("common");
	const [bounds, setBounds] = useState<RegionBounds | null>(null);
	const [scale, setScale] = useState(1);
	const [rect, setRect] = useState<PixelRect | null>(null);
	const [locked, setLocked] = useState(false);
	const [ratio, setRatio] = useState<number | null>(null);
	const [ratioLocked, setRatioLocked] = useState(false);
	const [customW, setCustomW] = useState("");
	const [customH, setCustomH] = useState("");
	const dragRef = useRef<DragState | null>(null);
	// Latest ratio for the window-level pointer handlers without re-binding them.
	const activeRatio = ratioLocked ? ratio : null;
	const activeRatioRef = useRef<number | null>(null);
	activeRatioRef.current = activeRatio;
	// The same ratio as whole numbers: the box is snapped to sizes that hit it exactly with even
	// sides, so what is recorded is the ratio that was set rather than a pixel off it.
	const [ratioParts, setRatioParts] = useState<RatioParts | null>(null);
	const activeParts = ratioLocked ? ratioParts : null;
	const activePartsRef = useRef<RatioParts | null>(null);
	activePartsRef.current = activeParts;
	const rectRef = useRef<PixelRect | null>(null);
	rectRef.current = rect;

	useEffect(() => {
		void window.electronAPI.getRegionSelectorContext().then((context) => {
			if (!context) {
				window.close();
				return;
			}
			setScale(context.scaleFactor);
			setBounds({ width: context.width, height: context.height });
		});
		return window.electronAPI.onRegionSelectorLocked(() => setLocked(true));
	}, []);

	// The box starts at the usual 17:10, locked, centred on the display. Everything about it can
	// still be changed: presets, a custom ratio, the lock, or dragging out a new box.
	const initialised = useRef(false);
	useEffect(() => {
		if (!bounds || initialised.current) return;
		initialised.current = true;
		const parts = ratioPartsOf(DEFAULT_RATIO.w, DEFAULT_RATIO.h);
		const next = DEFAULT_RATIO.w / DEFAULT_RATIO.h;
		setRatio(next);
		setRatioParts(parts);
		setRatioLocked(true);
		setCustomW(String(DEFAULT_RATIO.w));
		setCustomH(String(DEFAULT_RATIO.h));
		const fitted = applyRatio(defaultRect(bounds), next, bounds);
		setRect(parts ? snapToRatioGrid(fitted, parts, bounds) : fitted);
	}, [bounds]);

	const confirm = useCallback(() => {
		const current = rectRef.current;
		if (!current || !bounds) return;
		const parts = activePartsRef.current;
		const exact = parts ? snapToRatioGrid(current, parts, bounds) : current;
		void window.electronAPI.confirmRegion(toEvenPixelRect(exact, bounds));
	}, [bounds]);

	const cancel = useCallback(() => {
		void window.electronAPI.cancelRegion();
	}, []);

	useEffect(() => {
		if (locked) return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				cancel();
			} else if (event.key === "Enter" && !(event.target instanceof HTMLInputElement)) {
				confirm();
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [locked, confirm, cancel]);

	useEffect(() => {
		if (locked || !bounds) return;

		const onPointerMove = (event: PointerEvent) => {
			const drag = dragRef.current;
			if (!drag) return;
			const dx = (event.clientX - drag.startX) * scale;
			const dy = (event.clientY - drag.startY) * scale;
			const lockedRatio = activeRatioRef.current ?? undefined;

			if (drag.mode === "create") {
				const handle = `${dy < 0 ? "n" : "s"}${dx < 0 ? "w" : "e"}` as ResizeHandle;
				const origin = { x: drag.startX * scale, y: drag.startY * scale, width: 0, height: 0 };
				const created = resizeRect(origin, handle, dx, dy, bounds, lockedRatio);
				// A locked ratio has already been held to its own minimum size.
				setRect(lockedRatio ? created : clampRect(created, bounds));
			} else if (drag.mode === "move") {
				setRect(moveRect(drag.origin, dx, dy, bounds));
			} else {
				setRect(resizeRect(drag.origin, drag.handle, dx, dy, bounds, lockedRatio));
			}
		};
		const onPointerUp = () => {
			const wasDragging = dragRef.current !== null;
			dragRef.current = null;
			// Settle on an exact-ratio size once the drag is over (live, the box follows the
			// pointer smoothly instead of jumping between the grid's sizes).
			const parts = activePartsRef.current;
			if (wasDragging && parts) {
				setRect((current) => (current ? snapToRatioGrid(current, parts, bounds) : current));
			}
		};

		window.addEventListener("pointermove", onPointerMove);
		window.addEventListener("pointerup", onPointerUp);
		return () => {
			window.removeEventListener("pointermove", onPointerMove);
			window.removeEventListener("pointerup", onPointerUp);
		};
	}, [locked, bounds, scale]);

	if (!bounds) return null;

	const cssRect = rect && {
		left: rect.x / scale,
		top: rect.y / scale,
		width: rect.width / scale,
		height: rect.height / scale,
	};

	if (locked) {
		return (
			<div className="pointer-events-none fixed inset-0 select-none">
				{cssRect && (
					<div
						className="absolute border-2 border-[#34B27B]"
						style={{ ...cssRect, boxSizing: "border-box" }}
					/>
				)}
			</div>
		);
	}

	const startDrag = (event: React.PointerEvent, drag: DragState) => {
		event.preventDefault();
		event.stopPropagation();
		dragRef.current = drag;
	};

	const choosePreset = (w: number, h: number) => {
		const next = w / h;
		const parts = ratioPartsOf(w, h);
		setRatio(next);
		setRatioParts(parts);
		setRatioLocked(true);
		setCustomW(String(w));
		setCustomH(String(h));
		setRect((current) => {
			const fitted = applyRatio(current ?? defaultRect(bounds), next, bounds);
			return parts ? snapToRatioGrid(fitted, parts, bounds) : fitted;
		});
	};

	const applyCustomRatio = () => {
		const w = Number(customW);
		const h = Number(customH);
		if (w > 0 && h > 0) choosePreset(w, h);
	};

	const toggleRatioLock = () => {
		if (ratioLocked) {
			setRatioLocked(false);
			return;
		}
		const nextRatio = ratio ?? (rect ? rect.width / rect.height : null);
		if (nextRatio) {
			setRatio(nextRatio);
			// Locking the box as it is: its ratio to two decimals, so the grid stays small.
			const parts = ratioParts ?? ratioPartsOf(nextRatio, 1);
			setRatioParts(parts);
			setRatioLocked(true);
			if (parts)
				setRect((current) => (current ? snapToRatioGrid(current, parts, bounds) : current));
		}
	};

	const commitSize = (key: "width" | "height", value: string) => {
		const px = Number(value);
		if (!rect || !Number.isFinite(px) || px <= 0) return;
		const resized = setRectSize(rect, { [key]: px }, bounds, activeRatio ?? undefined);
		setRect(activeParts ? snapToRatioGrid(resized, activeParts, bounds) : resized);
	};

	const toolbarBelow = cssRect
		? cssRect.top + cssRect.height + TOOLBAR_GAP + TOOLBAR_HEIGHT <= bounds.height / scale
		: true;
	const toolbarTop = cssRect
		? toolbarBelow
			? cssRect.top + cssRect.height + TOOLBAR_GAP
			: Math.max(8, cssRect.top - TOOLBAR_GAP - TOOLBAR_HEIGHT)
		: 0;

	return (
		<div
			className="fixed inset-0 select-none"
			style={{ cursor: "crosshair" }}
			onPointerDown={(event) => {
				setRect(null);
				startDrag(event, { mode: "create", startX: event.clientX, startY: event.clientY });
			}}
		>
			{!cssRect && (
				<>
					<div className="absolute inset-0 bg-black/30" />
					<div className="pointer-events-none absolute left-1/2 top-[45%] -translate-x-1/2 rounded-xl bg-black/70 px-4 py-2 text-xs text-white/90">
						{t("regionSelector.hint")}
					</div>
				</>
			)}
			{cssRect && (
				<>
					<div
						className="absolute border-2 border-[#34B27B]"
						style={{
							...cssRect,
							boxSizing: "border-box",
							boxShadow: "0 0 0 100vmax rgba(0,0,0,0.4)",
							cursor: "move",
						}}
						onPointerDown={(event) =>
							rect &&
							startDrag(event, {
								mode: "move",
								startX: event.clientX,
								startY: event.clientY,
								origin: rect,
							})
						}
						onDoubleClick={confirm}
					>
						{HANDLES.map(({ handle, style, cursor }) => (
							<div
								key={handle}
								data-testid={`region-handle-${handle}`}
								className="absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-[#34B27B] bg-white"
								style={{ ...style, cursor }}
								onPointerDown={(event) =>
									rect &&
									startDrag(event, {
										mode: "resize",
										handle,
										startX: event.clientX,
										startY: event.clientY,
										origin: rect,
									})
								}
							/>
						))}
					</div>
					<div
						className="absolute z-10 flex -translate-x-1/2 items-center gap-2 rounded-xl border border-white/10 bg-zinc-900/95 px-2.5 shadow-xl"
						style={{
							left: Math.min(
								Math.max(cssRect.left + cssRect.width / 2, 380),
								bounds.width / scale - 380,
							),
							top: toolbarTop,
							height: TOOLBAR_HEIGHT,
							cursor: "default",
						}}
						onPointerDown={(event) => event.stopPropagation()}
					>
						<div className="flex items-center gap-1">
							{RATIO_PRESETS.map((preset) => {
								const active =
									ratioLocked && ratio !== null && Math.abs(ratio - preset.w / preset.h) < 1e-6;
								return (
									<button
										key={preset.label}
										type="button"
										onClick={() => choosePreset(preset.w, preset.h)}
										className={`h-6 rounded-md px-1.5 text-[11px] transition-colors ${
											active
												? "bg-[#34B27B] text-white"
												: "bg-white/[0.06] text-zinc-300 hover:bg-white/[0.12]"
										}`}
									>
										{preset.label}
									</button>
								);
							})}
						</div>
						<div className="flex items-center gap-1 text-[11px] text-zinc-400">
							<input
								aria-label={t("regionSelector.ratioWidth")}
								className={inputClass}
								inputMode="numeric"
								value={customW}
								onChange={(event) => setCustomW(event.target.value)}
								onBlur={applyCustomRatio}
								onKeyDown={(event) => event.key === "Enter" && applyCustomRatio()}
							/>
							:
							<input
								aria-label={t("regionSelector.ratioHeight")}
								className={inputClass}
								inputMode="numeric"
								value={customH}
								onChange={(event) => setCustomH(event.target.value)}
								onBlur={applyCustomRatio}
								onKeyDown={(event) => event.key === "Enter" && applyCustomRatio()}
							/>
						</div>
						<button
							type="button"
							aria-pressed={ratioLocked}
							title={t("regionSelector.lockRatio")}
							onClick={toggleRatioLock}
							className={`flex h-6 w-6 items-center justify-center rounded-md transition-colors ${
								ratioLocked ? "bg-[#34B27B] text-white" : "bg-white/[0.06] text-zinc-300"
							}`}
						>
							{ratioLocked ? <MdLock size={14} /> : <MdLockOpen size={14} />}
						</button>
						<div className="h-5 w-px bg-white/10" />
						<div className="flex items-center gap-1 text-[11px] text-zinc-400">
							<SizeInput
								label={t("regionSelector.width")}
								value={Math.round(rect?.width ?? 0)}
								onCommit={(value) => commitSize("width", value)}
							/>
							×
							<SizeInput
								label={t("regionSelector.height")}
								value={Math.round(rect?.height ?? 0)}
								onCommit={(value) => commitSize("height", value)}
							/>
						</div>
						<div className="h-5 w-px bg-white/10" />
						<button
							type="button"
							onClick={cancel}
							className="h-6 rounded-md px-2 text-[11px] text-zinc-300 hover:bg-white/10"
						>
							{tc("actions.cancel")}
						</button>
						<button
							type="button"
							onClick={confirm}
							disabled={!rect || rect.width < MIN_REGION_SIZE}
							className="h-6 rounded-md bg-[#34B27B] px-2.5 text-[11px] font-semibold text-white hover:bg-[#34B27B]/85 disabled:opacity-40"
						>
							{t("regionSelector.confirm")}
						</button>
					</div>
				</>
			)}
		</div>
	);
}

function defaultRect(bounds: RegionBounds): PixelRect {
	const width = bounds.width / 2;
	const height = bounds.height / 2;
	return { x: (bounds.width - width) / 2, y: (bounds.height - height) / 2, width, height };
}

function SizeInput({
	label,
	value,
	onCommit,
}: {
	label: string;
	value: number;
	onCommit: (value: string) => void;
}) {
	const [draft, setDraft] = useState<string | null>(null);
	const commit = () => {
		if (draft !== null) onCommit(draft);
		setDraft(null);
	};
	return (
		<input
			aria-label={label}
			className={`${inputClass} w-14`}
			inputMode="numeric"
			value={draft ?? String(value)}
			onChange={(event) => setDraft(event.target.value)}
			onBlur={commit}
			onKeyDown={(event) => event.key === "Enter" && commit()}
		/>
	);
}

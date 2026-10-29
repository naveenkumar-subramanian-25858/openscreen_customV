// @vitest-environment jsdom
// "Video + click sounds": the video goes out without the compositor's click mix, and the clicks
// land next to it as a WAV. Plain Export is untouched.
import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hasClicks = vi.hoisted(() => ({ value: true }));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock("@/native", () => ({
	exportMultiNative: vi.fn(async () => ({ videoDurationS: 10, wallS: 2 })),
	exportGifNative: vi.fn(async () => ({ videoDurationS: 10, wallS: 2 })),
	useIsCpuCompositor: () => false,
}));

vi.mock("@/native/sceneDescription", () => ({
	buildSceneDescription: () => ({
		speedRegions: [],
		clickSound: { downPath: "/d.wav", upPath: "/u.wav", hits: [] },
	}),
	resolveVisibleClips: (doc: AxcutDocument) => doc.timeline.clips,
}));

vi.mock("@/hooks/useClickSound", () => ({
	useClickSound: () => ({ hasClicks: hasClicks.value, prepare: async () => undefined }),
}));

const renderClickSoundWav = vi.hoisted(() => vi.fn());
vi.mock("@/lib/ai-edition/clickSoundExport", () => ({ renderClickSoundWav }));

import { I18nProvider } from "@/contexts/I18nContext";
import { type AxcutDocument, axcutSchemaVersion } from "@/lib/ai-edition/schema";
import { exportMultiNative } from "@/native";
import { ExportDialog } from "./ExportDialog";

type ElectronAPI = Window["electronAPI"];

const noop = () => undefined;

const DOC: AxcutDocument = {
	schemaVersion: axcutSchemaVersion,
	project: {
		id: "proj_1",
		title: "Clicks",
		createdAt: "2026-09-25T10:00:00Z",
		updatedAt: "2026-09-25T10:00:00Z",
		primaryAssetId: "a1",
	},
	assets: [
		{
			id: "a1",
			kind: "video",
			label: "asset",
			originalPath: "/tmp/a.mp4",
			cameraTrack: null,
			video: { codec: "h264", width: 1920, height: 1080, fps: 60 },
		},
	],
	transcript: null,
	transcripts: [],
	timeline: {
		clips: [
			{
				id: "c1",
				assetId: "a1",
				sourceStartSec: 0,
				sourceEndSec: 10,
				timelineStartSec: 0,
				timelineEndSec: 10,
				wordRefs: [],
				origin: "user",
				reason: "",
			},
		],
		gaps: [],
		trimRanges: [],
		muteRanges: [],
		speedRanges: [],
		captionRanges: [],
	},
	annotations: [],
	zoomRanges: [],
	audioTracks: [],
	legacyEditor: { aspectRatio: "16:9" },
};

const writeExportToPath = vi.fn(async (_data: ArrayBuffer, filePath: string) => ({
	success: true,
	path: filePath,
}));

function renderDialog() {
	render(
		<I18nProvider>
			<ExportDialog open={true} onClose={noop} document={DOC} />
		</I18nProvider>,
	);
}

describe("ExportDialog video + click sounds", () => {
	beforeEach(() => {
		hasClicks.value = true;
		renderClickSoundWav.mockResolvedValue(new ArrayBuffer(8));
		window.electronAPI = {
			pickExportSavePath: vi.fn(async () => ({ path: "/tmp/demo.mp4" })),
			onNativeExportProgress: vi.fn(() => noop),
			writeExportToPath,
		} as unknown as ElectronAPI;
	});

	afterEach(() => {
		cleanup();
		vi.clearAllMocks();
	});

	it("renders the video without the click mix and saves the clicks as a WAV beside it", async () => {
		renderDialog();
		fireEvent.click(screen.getByTestId("export-video-and-clicks"));
		await waitFor(() => expect(writeExportToPath).toHaveBeenCalled());

		const sceneJson = vi.mocked(exportMultiNative).mock.calls.at(-1)?.[2] as string;
		expect(JSON.parse(sceneJson)).not.toHaveProperty("clickSound");
		expect(renderClickSoundWav).toHaveBeenCalledWith(DOC, 10);
		expect(writeExportToPath.mock.calls[0][1]).toBe("/tmp/demo-clicks.wav");
	});

	it("leaves plain Export mixing the clicks in, with no extra file", async () => {
		renderDialog();
		fireEvent.click(screen.getByRole("button", { name: /export mp4/i }));
		await waitFor(() => expect(exportMultiNative).toHaveBeenCalled());

		const sceneJson = vi.mocked(exportMultiNative).mock.calls.at(-1)?.[2] as string;
		expect(JSON.parse(sceneJson)).toHaveProperty("clickSound");
		expect(writeExportToPath).not.toHaveBeenCalled();
	});

	it("offers the button only for a take that has clicks", () => {
		hasClicks.value = false;
		renderDialog();
		expect(screen.queryByTestId("export-video-and-clicks")).toBeNull();
	});
});

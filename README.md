<p align="center">
  <img src="public/openscreen.png" alt="OpenScreen Logo" width="64" />
</p>

# <p align="center">OpenScreen (custom build)</p>

<p align="center">A free, open-source screen recorder and video editor for polished demos and walkthroughs.</p>

This is a customized fork of [OpenScreen](https://github.com/getopenscreen/openscreen) (MIT licensed), which continues the original project by Siddharth Vaddem.

## Features

**Recording**
- Record the whole screen, a window, or a **region**. Region mode opens a selection overlay right away on the display under your cursor. It defaults to 17:10, you can change the ratio or size freely, and Esc cancels.
- The region is cropped **at capture time** at native (Retina) resolution, so there is no full-screen recording to crop later.
- Microphone, system audio and webcam overlay.
- Cursor and clicks are recorded separately, so you can restyle them (size, smoothing, click effects) in the editor.
- A "Maximum quality" capture default: high bitrate H.264, native resolution up to 8K.

**Editing**
- Auto and manual zooms, backgrounds, padding, motion blur, crop (including custom ratios), trim, and per-segment speed.
- Text, arrow and image annotations.
- Automatic on-device captions with an editable transcript.
- Optional AI editing assistant (bring your own API key; off by default).

**Projects and export**
- **Save** (Cmd/Ctrl+S), **Save As…** (Cmd/Ctrl+Shift+S) and **Open Project…** with native dialogs. Projects are `.openscreen` files, written atomically so a crash can't corrupt them.
- Export to MP4 or GIF. Export size matches your crop, and "Source" quality is the default.
- Click sounds can be exported as a separate audio file.

## Install (macOS)

Requires macOS 13 or later, Node 22 and npm.

```bash
git clone https://github.com/naveenkumar-subramanian-25858/openscreen_customV.git
cd openscreen_customV
npm install
npm run build:mac
```

The app is built into `release/`. Drag `Openscreen.app` into `/Applications`.

On first launch, open **System Settings > Privacy & Security** and grant **Screen Recording** (and **Accessibility** for cursor tracking), then relaunch the app.

To run in development mode instead: `npm run dev`.

Windows and Linux: build with `npm run build:win` or the Linux scripts in `package.json`. The macOS path is the one tested for this fork.

## Use

1. Open the app and pick a source: **Screen**, **Window** or **Region**.
2. For Region, drag or resize the overlay (default 17:10) and click **Record this region**.
3. Click **Record**, then stop when you're done. The editor opens with your take.
4. Edit: add zooms, set the background and padding, trim, add captions.
5. **Cmd+S** to save the project, then **Export** to MP4 or GIF.

## Troubleshooting

- **Can't record / permission prompt keeps appearing:** grant Screen Recording in System Settings, then fully quit and relaunch the app.
- **Recording stops with error -3805:** macOS dropped the capture connection, usually because the screen locked or slept mid-recording. Keep the display awake while recording.

## License

[MIT](./LICENSE).

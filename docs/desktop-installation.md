# Windows desktop installation

The desktop host retains the Next Studio and Python voice engine. It supplies Electron's Node runtime, a production standalone frontend, uv, FFmpeg and FFprobe. Users need a supported NVIDIA GPU (12 GB VRAM) and current driver; system Python, Node, Git and developer terminals are not required for the packaged application.

## First launch

Run the Windows installer, then open VibePod. The approved setup screen checks the GPU, lets you choose separate model and library folders, and offers optional voice design. The engine installs locked Python 3.12.9/CUDA dependencies into application storage. This requires an Internet connection and space for both dependencies and their download cache. Models use pinned checkpoint revisions with verified LFS hashes; progress reports actual bytes and verification stages.

Model downloads can be paused and resumed. Chosen locations and a verified pending engine survive an interrupted setup. Configuration becomes active only after final verification. Optional voice design can be added through Review storage settings.

The host starts two loopback services on available ports and opens the Studio after both are ready. Closing the desktop stops its owned service trees. Other running VibePod instances and developer servers are not stopped.

## Storage and recovery

Engine setup reports dependency preparation and actual runtime file activity in the existing engine row. It records subprocess starts/exits and verbose dependency diagnostics in the persistent log. File activity is not a download percentage; no overall engine percentage is invented.

Runtime metadata, logs, Python and dependency caches live under Electron's user-data folder in `installation/`. Models and the complete library live at the selected locations, outside the runtime. `VIBEPOD_DATA_DIR` directs all backend stores to that library. Back up the whole library folder, including its database and audio. Existing repository data is not automatically imported or moved.

Recovery distinguishes graphics-driver issues, model downloads, voice-engine dependencies and Studio application startup. Engine repair builds and verifies a new environment before changing the active pointer, retaining the previous runtime. It preserves models, episodes, voices and audio. Model recovery reuses verified files and partial downloads. Application-file failures offer logs and reinstall guidance. Uninstall does not delete the selected model or library folders.

Changing installed storage locations and automatic application updates are not yet implemented. Retaining the previous runtime does not yet provide a user-facing rollback command. First installation currently uses bundled uv and the dependency lock, rather than prebuilt GPU environment archives.

## Developer build

Run the repository Windows setup first, then:

```powershell
pnpm desktop:prepare
pnpm desktop
pnpm desktop:package
pnpm test:desktop
```

Development may reuse the repository's verified Python environment and model files, but uses a separate desktop library. The production installer creates its own runtime. Build tools must resolve to real uv, FFmpeg and FFprobe executables, not PATH shims. Explicit `VIBEPOD_UV_BINARY`, `VIBEPOD_FFMPEG_BINARY` and `VIBEPOD_FFPROBE_BINARY` paths override discovery. Generated resources are ignored by Git.

Build output defaults to `%LOCALAPPDATA%/VibePod/desktop-builds/<checkout-id>`; `VIBEPOD_DESKTOP_OUTPUT` overrides it. Packaging checks for 2 GB free build space. Close the desktop before preparing its resources. Builds are unsigned unless signing credentials are configured. This is a development installer, not a signed release.

Current-machine checks cover the native host, real GPU detection, verification of existing pinned models, production Studio startup, isolated library storage and transactional repair tests. These do not validate installation on a clean Windows machine. That test remains explicitly deferred.

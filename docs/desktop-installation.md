# Windows desktop installation

The desktop host retains the Next Studio and Python voice engine and gives end users one application to install and open.

## Installing (end users)

Run `VibePod Setup <version>.exe`. Nothing else needs installing first except an NVIDIA GPU with at least 8 GB VRAM and a current graphics driver. The installer bundles Electron's Node runtime, the production Studio frontend, uv, FFmpeg and FFprobe; system Python, Node, Git, pnpm and developer terminals are not required, and `setup.ps1` is not part of this path. The Python/CUDA engine and the models are downloaded by the application on first launch.

## First launch

Run the Windows installer, then open VibePod. The approved setup screen checks the GPU, lets you choose separate model and library folders, and offers optional voice design. The engine installs locked Python 3.12.9/CUDA dependencies into application storage. This requires an Internet connection and space for both dependencies and their download cache. Models use pinned checkpoint revisions with verified LFS hashes; progress reports actual bytes and verification stages.

Model downloads can be paused and resumed. Chosen locations and a verified pending engine survive an interrupted setup. Configuration becomes active only after final verification. Optional voice design can be added through Review storage settings.

The host starts two loopback services on available ports and opens the Studio after both are ready. Closing the desktop stops its owned service trees. Other running VibePod instances and developer servers are not stopped.

## Storage and recovery

Engine setup reports dependency preparation and actual runtime file activity in the existing engine row. It records subprocess starts/exits and verbose dependency diagnostics in the persistent log. File activity is not a download percentage; no overall engine percentage is invented.

Runtime metadata, logs, Python and dependency caches live under Electron's user-data folder in `installation/`. Models and the complete library live at the selected locations, outside the runtime. `VIBEPOD_DATA_DIR` directs all backend stores to that library. Back up the whole library folder, including its database and audio. Existing repository data is not automatically imported or moved.

Recovery distinguishes graphics-driver issues, model downloads, voice-engine dependencies and Studio application startup. Engine repair builds and verifies a new environment before changing the active pointer, retaining the previous runtime. It preserves models, episodes, voices and audio. Model recovery reuses verified files and partial downloads. At launch the app checks each model file against the size recorded when it was hash-verified, so a missing or truncated file sends you to model recovery instead of failing at the first generation. Application-file failures offer logs and reinstall guidance. Uninstall does not delete the selected model or library folders.

Changing installed storage locations and automatic application updates are not yet implemented. Retaining the previous runtime does not yet provide a user-facing rollback command. First installation currently uses bundled uv and the dependency lock, rather than prebuilt GPU environment archives.

## Building the installer

The installer is built on a Windows build machine, then copied to any machine that should install it. The build machine needs the prerequisites below; the installing machine does not.

1. Install the build prerequisites: Git, Node 22 or newer, pnpm 11, uv, FFmpeg and FFprobe. `./setup.ps1 -InstallTools` installs them with winget, but it also installs the full development environment and downloads the models, so it is more than a build needs. `desktop:prepare` copies uv, FFmpeg and FFprobe from this machine into the installer; it does not download them, and stops with "Missing build tool" if one is absent.
2. From the repository root:

```powershell
pnpm install
pnpm desktop:prepare
pnpm desktop:package
```

The repository uses pnpm 11. The dependency build scripts it allows (Electron, its installer tooling and sharp) are listed under `allowBuilds` in `pnpm-workspace.yaml`, so a fresh `pnpm install` needs no manual approval. Build tools must resolve to real uv, FFmpeg and FFprobe executables, not PATH shims. Explicit `VIBEPOD_UV_BINARY`, `VIBEPOD_FFMPEG_BINARY` and `VIBEPOD_FFPROBE_BINARY` paths override discovery. Generated resources are ignored by Git.

Build output defaults to `%LOCALAPPDATA%/VibePod/desktop-builds/<checkout-id>`; `VIBEPOD_DESKTOP_OUTPUT` overrides it. Packaging checks for 2 GB free build space. Close the desktop before preparing its resources. Builds are unsigned unless signing credentials are configured, so this is a development installer, not a signed release. The version comes from `desktop/package.json`; it is 0.1.0 until a release is made.

## Running the desktop from source

After the repository's development setup (`./setup.ps1 -InstallTools`, see [Windows setup and development](windows-development.md)):

```powershell
pnpm desktop:prepare
pnpm desktop
pnpm test:desktop
```

Development may reuse the repository's verified Python environment and model files, but uses a separate desktop library. The production installer creates its own runtime.

## Verification status

Current-machine checks cover the native host, real GPU detection, verification of existing pinned models, production Studio startup, isolated library storage and transactional repair tests. They do not validate installation on a clean Windows machine; that test has not been completed.

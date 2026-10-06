# Desktop runtime direction

VibePod should retain its Studio frontend and Python inference engine. A desktop host can own their installation and lifecycle so users launch one application without managing terminals or system Python. The existing setup scripts and supervisor remain the developer entry points.

## What Comfy Desktop demonstrates

The [current official Comfy Desktop](https://github.com/Comfy-Org/Comfy-Desktop) provisions isolated, relocatable Python environments with prebuilt GPU dependencies. It supports independent installations, updates and snapshots/rollback. Its desktop host is Electron; a bundled bootstrap supports machines without system Git. This differs from the [archived uv-based Desktop](https://github.com/Comfy-Org/desktop).

Their earlier [maintenance interface](https://blog.comfy.org/p/easy-installation-in-desktop) offered environment creation, dependency repair and installation-location changes after detecting problems. The transferable idea is actionable recovery inside the application.

## Proposed VibePod contract

- A Windows installer supplies the desktop host and frontend runtime. A versioned, verified inference runtime is installed into application-managed storage. Users need a supported GPU and driver; they do not need development tools on PATH.
- First launch lets users choose storage locations and shows actual download and verification progress. Large models stay separate from application releases and are reused across updates.
- The host starts the two loopback services, waits for readiness, opens the Studio, and owns shutdown. It reports startup failures with logs and specific repair actions.
- Application updates and inference-runtime updates are distinct. Prepare and validate a new runtime before switching; retain the previous working runtime for recovery. Repair must preserve episodes, voices and generated audio.
- Development still uses locked setup and one supervised command. A packaged build uses a production frontend, rather than the development server.

## Implemented first step

The approved installer and repair interface now runs in an Electron host with a Windows NSIS installer. It bundles the standalone production frontend, uv and audio encoders. It provisions isolated locked Python environments, reports real model-download progress and starts/stops both loopback services. Runtime repair verifies a candidate before switching pointers and preserves model and library folders. See [desktop installation](desktop-installation.md).

Prebuilt GPU runtime archives, signed releases, automatic updates, user-facing rollback and data migration remain future work. The installer, startup and repair design was approved before integration. Fresh-install testing is explicitly deferred by the user; current-machine checks do not substitute for a clean Windows test.

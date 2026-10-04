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

## Decisions still needed before implementation

Select the desktop host and packaging strategy; establish runtime artifact production, integrity checks and supported GPU profiles; define safe data migration and rollback boundaries. Electron is a candidate, not a committed framework choice.

Preview the installer, startup and repair UI for user approval before integration. Validate the eventual installer on a clean Windows machine; the current-machine setup smoke test does not substitute for that test. Fresh-install testing is explicitly deferred by the user.

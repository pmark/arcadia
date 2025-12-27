# launchd notes

The LaunchAgent plist references the orchestrator path:

    %HOME%/ArcadiaBootstrap/arcadia/orchestrator.py

During installation, place this repo at:

    ~/ArcadiaBootstrap

If you choose a different path, update launchd/com.arcadia.orchestrator.plist before loading it.

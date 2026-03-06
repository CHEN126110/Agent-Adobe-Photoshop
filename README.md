# Agent-Adobe-Photoshop

Agent + Adobe Photoshop UXP workspace for e-commerce design automation.

## Structure

- `DesignEcho-Agent`: Electron desktop agent, orchestration, IPC, model routing, structured knowledge, and UI
- `DesignEcho-UXP`: Adobe Photoshop UXP plugin and Photoshop-side execution tools
- `docs`: project status, cleanup plan, capability matrix, and technical notes

## Notes

- Local model files and archived asset directories are intentionally not tracked in Git.
- Install dependencies locally before building:
  - `cd DesignEcho-Agent && npm install`
  - `cd ../DesignEcho-UXP && npm install`
- External assistant debug bridge:
  - [docs/debug-bridge.md](/C:/UXP/2.0/docs/debug-bridge.md)
  - Base URL: `http://127.0.0.1:8767`
- Git auto sync:
  - [docs/git-auto-sync.md](/C:/UXP/2.0/docs/git-auto-sync.md)
  - Script: `.\scripts\git-auto-sync.ps1`

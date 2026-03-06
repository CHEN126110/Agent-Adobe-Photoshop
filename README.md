# Agent-Adobe-Photoshop

Agent + Adobe Photoshop UXP workspace for e-commerce design automation.

## Structure

- `DesignEcho-Agent`: Electron desktop agent, orchestration, IPC, model routing, RAG, and UI
- `DesignEcho-UXP`: Adobe Photoshop UXP plugin and Photoshop-side execution tools
- `docs`: project status, cleanup plan, capability matrix, and technical notes

## Notes

- Local model files and archived asset directories are intentionally not tracked in Git.
- Install dependencies locally before building:
  - `cd DesignEcho-Agent && npm install`
  - `cd ../DesignEcho-UXP && npm install`

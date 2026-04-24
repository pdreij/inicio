# Inicio

Desktop app for running and monitoring scripts across multiple local projects.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)
![Rust](https://img.shields.io/badge/Rust-stable-000000?logo=rust&logoColor=white)

[Features](#features) · [Quick Start](#quick-start) · [Development Mode](#development-mode) · [Build and Install](#build-and-install)

---

## Features

| Feature | Description |
| --- | --- |
| Multi-project workspace | Add one project or import child projects from a parent folder |
| Script runner | Run/stop scripts with status tracking and live logs |
| Crash-focused UX | Logs auto-open when a script fails |
| Outdated dependencies | Check outdated packages and update selected packages to latest |
| Package manager support | npm, pnpm, yarn, and bun |
| Resource monitoring | CPU/RAM indicators for running scripts |
| Native desktop behavior | macOS menu bar actions and system notifications |

## Quick Start

### Prerequisites

- Node.js (LTS recommended)
- Rust toolchain
- Tauri system dependencies for your OS

### Clone and run

```bash
git clone <your-repo-url>
cd inicio
npm install
npm run tauri dev
```

---

## Development Mode

Run in desktop dev mode:

```bash
npm run tauri dev
```

This starts:
- Vite frontend (hot reload)
- Tauri desktop shell

Important: use `npm run tauri dev` (not `npm run dev`) when testing native features.

---

## Build and Install

### Build a distributable app

```bash
npm install
npm run tauri build
```

Build artifacts are generated in:
- `src-tauri/target/release/bundle/`

### Install (macOS)

Open the generated `.dmg` (or `.app`) and move Inicio to `Applications`. Or just drag the icon to Application if the installation modal opens.

---

## Tech Stack

- Tauri (Rust backend)
- React + TypeScript
- Vite
- Tailwind CSS

---

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

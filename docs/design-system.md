# Deadlock City — Design System & Visual Direction

## 1. Analysis of Reference Image

The reference UI depicts a **futuristic 3D isometric/perspective city-strategy simulation** (*Industries of Titan* aesthetic). Rather than presenting a generic flat web dashboard with cards on a light/dark page, the application treats the **3D city itself as the primary 100% viewport canvas**, surrounded by crisp, low-footprint floating HUD panels anchored to the screen perimeter.

### Key Visual Traits Observed
1. **Viewport-First Hierarchy**:
   - The 3D city occupies `100vw × 100vh`.
   - Floating HUD elements hug the top edge, mid-left inspector rail, mid-right summary badge, bottom-center command dock, and bottom-right circular command core—leaving ~75%+ of the central screen unobstructed for inspecting buildings and dependency links.
2. **Atmospheric Twilight Cityscape**:
   - Deep twilight-slate atmospheric fog (`#0f1c2e` foreground fading into `#2b4d6b` / `#3f6785` horizon haze) gives instant depth separation between the dark background urban grid and active glowing structures.
   - Dark, faceted low-poly industrial city blocks sit on an orthogonal street grid, while **active focal buildings** stand taller with crisp glowing rim lights and floating holographic glyphs above their rooftops.
3. **High-Contrast Tactical HUD**:
   - **Panels**: Deep midnight-indigo translucent surfaces (`rgba(13, 16, 33, 0.88)`) with `backdrop-filter: blur(10px)`, razor-thin `1px` borders (`#2b3460`), and selective angled/chamfered header tags.
   - **Selection & Highlighting**:
     - Selected / previewed structure: **Electric Cyan holographic wireframe / translucent glow (`#00e5ff`)**.
     - Active / contended / high-priority structure: **Magenta-Crimson rim glow (`#ec4899` / `#ef4444`)** with warm amber indicators.
     - Network / Resource Ownership conduits: **Thin glowing cyan ground/elevated laser lines** connecting buildings and facilities.
   - **Floating World-Space Tooltips**:
     - Compact dark translucent tooltip anchored directly beside the hovered/selected 3D structure with title, subtitle, single-line resource readout, and keyboard/mouse hint.

---

## 2. Color Palette & Semantic Tokens

### Base Surfaces
| Token | Hex / Value | Usage |
| :--- | :--- | :--- |
| `--bg-void` | `#080c18` | Deepest canvas / fallback background |
| `--bg-fog-near` | `#0f1c2e` | 3D scene near ground / shadow tone |
| `--bg-fog-far` | `#2b4d6b` | 3D scene horizon atmospheric haze |
| `--hud-surface` | `rgba(13, 17, 36, 0.88)` | Primary floating HUD panels & cards |
| `--hud-surface-elevated` | `rgba(19, 25, 52, 0.94)` | Modals, tooltips, active tab bar |
| `--hud-border` | `#28335c` | Default 1px structural border |
| `--hud-border-active` | `#22d3ee` | Focused / active panel or selection border |

### Brand & Tactical Accents
| Token | Hex | Usage |
| :--- | :--- | :--- |
| `--accent-cyan` | `#00e5ff` / `#22d3ee` | Selection, active navigation, allocation conduits, primary CTA |
| `--accent-indigo` | `#6366f1` | Secondary HUD trims, progress bars, structural framing |
| `--accent-magenta` | `#ec4899` | High-priority process rim accent, request edge emphasis |
| `--accent-amber` | `#f59e0b` | Unsafe state (Banker's), waiting/requested resources, warnings |
| `--accent-red` | `#ef4444` | Deadlock detected, blocked process pulse, cycle highlight |
| `--accent-emerald` | `#10b981` | Safe state, available resource pool, completed / healthy status |

### Text & Ink
| Token | Hex | Usage |
| :--- | :--- | :--- |
| `--text-primary` | `#f8fafc` | Metric numbers, headers, active labels |
| `--text-secondary` | `#94a3b8` | Field labels, secondary descriptions |
| `--text-muted` | `#64748b` | Disabled controls, grid coordinates, hints |

---

## 3. Typography

- **HUD Display & Headers**: `'Space Grotesk', 'Inter', system-ui, sans-serif` — geometric, crisp uppercase/title-case headers (`letter-spacing: 0.04em` on small caps badges).
- **Body & Controls**: `'Inter', system-ui, sans-serif` — clean legibility at `12px–14px` in dense inspector tables.
- **Telemetry & Matrices**: `'JetBrains Mono', monospace` with `font-variant-numeric: tabular-nums` — mandatory for live counters, Banker's matrices, Gantt timelines, tick clocks, and percentages so digits never jitter during simulation updates.

### Type Scale
- Top bar KPI value: `13px`, `font-weight: 600`, tabular mono
- Panel header: `13px`, `font-weight: 600`, uppercase/semi-condensed
- Section subheader: `11px`, `font-weight: 600`, `#94a3b8`, `tracking-wider`
- Table / inspector row: `12px`
- Micro badge / hotkey hint: `10px`, tabular mono

---

## 4. Layout Geometry & Persistent Shell

Every screen shares a unified persistent shell so the user never loses simulation context:

1. **Top Telemetry Strip (`38px` fixed height)**:
   - Left cluster: Brand mark + System Safety Status Ribbon (`SAFE` / `UNSAFE` / `DEADLOCK` angled banner just below top-left, echoing the reference's angled status tag) + compact icon metrics (`Processes`, `Resources`, `Allocated`, `Blocked`, `Deadlocks`, `Tick`).
   - Right cluster: Active simulation seed/preset pill + compact **Live Activity Queue** stacked cleanly under the top-right corner (showing running processes' remaining burst progress bars and active safety/detection status).

2. **Left Edge Inspector Rail (`260px` max width, floating)**:
   - Visible when a Process Building or Resource Facility is selected in City or Graph mode (or collapsible on secondary views).
   - Displays vertical icon+metric rows mirroring the reference's left-side `Relay` inspector: State badge, CPU Burst Progress, Priority, Allocated vector, Max Demand vector, Remaining Need vector, and immediate action buttons (`Request`, `Release`, `Suspend/Resume`, `Terminate`).

3. **Bottom-Center Two-Tier Command Dock**:
   - **Upper contextual action strip**: Square `36×36px` icon buttons directly above the active module tab (e.g., Spawn Process, Add Resource, Request Resource, Release, Load Preset, Randomize).
   - **Lower primary navigation bar**: Compact horizontal tabs with icon + label + numeric hotkey (`1`–`0`), grouped logically:
     - `1` City (`Overview + 3D City Command Center`)
     - `2` Graph (`Resource Allocation Graph`)
     - `3` Detect (`Deadlock Detection Engine`)
     - `4` Banker's (`Avoidance & Safety Matrices`)
     - `5` Recovery (`Termination, Preemption, Rollback`)
     - `6` Processes (`Process & Resource Table`)
     - `7` Scheduling (`CPU Scheduling Lab & Gantt`)
     - `8` Sync Lab (`C++ Concurrency Experiments`)
     - `9` Analytics (`Metrics, Charts & Exports`)
     - `0` Docs (`OS Guide & Reference`)

4. **Bottom-Right Radial Simulation Control Core**:
   - Circular command dial showing current `Tick` and simulation mode (`RUNNING` / `PAUSED` / `STEP`), surrounded by curved/radial action buttons:
     - Play / Pause
     - Step Forward (`+1 Tick`)
     - Reset Simulation
     - Speed Toggle (`0.5x / 1x / 2x / 4x`)
     - Quick Deadlock Scan

---

## 5. Cross-Page Consistency Rules

- **City View (`1`)** is the full-bleed 3D canvas with floating peripheral HUD panels.
- **Secondary Modules (`2`–`0`)** render inside a centered/docked tactical glass workspace frame (`top: 48px`, `bottom: 92px`) over a subtly dimmed 3D city backdrop (or clean dark-slate grid for React Flow / Recharts), using the exact same `#0d1124/90` panel surface, `#28335c` borders, `#22d3ee` cyan active highlights, and tabular monospace numbers.
- **No Unrelated Design Systems**: All tables, matrices, React Flow nodes, Recharts tooltips, and modal dialogs inherit these exact tokens.
- **Restrained Motion**: Animate state transitions (building glow changes, packet pulses along edges, panel mount/unmount via Framer Motion `150–220ms` ease-out). Never animate idle elements needlessly.

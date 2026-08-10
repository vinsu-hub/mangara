# Mangara

An AI-assisted manga creation tool. Reference mockups live in `reference images/` and define the product surface:

- **Main Chat** (`mainchat.png`) — conversational AI assistant for generating/editing panels, scoped to "This Panel / This Page / This Chapter / Project-Wide". Shows an AI plan with checked steps before applying changes, plus active-context and suggestion panels.
- **Prompt Studio** (`prompting.png`) — structured "guided prompt" builder: Scene, Composition (camera/angle/view/focus), Characters present, World & Mood, Style & References, Constraints — compiled into an "AI Interpretation" structured prompt with a live panel preview and generation checklist.
- **Editing** (`editing.png`) — canvas-based page/panel editor: panel shapes (rectangle/polygon/freeform), split/merge/duplicate, an Inspector with geometry, shape, AI content prompt, references, assigned character, and review status (Approved / Needs Changes / Send Back).
- **Story Board** (`story board.png`) — chapters → scenes → beats → outline hierarchy, with per-scene progress, page/panel counts, characters present, and notes.
- **Character Ref** (`character reference.png`) — per-character sheets: turnaround, basic info, expressions, pose references, a "Consistency Lock" (per-attribute sliders: face identity, hair style, clothing, weapon, proportions) controlling AI generation variance, and a relationship graph to other characters.
- **Assets** (`assets.png`) — shared library of images/sketches/3D/video/audio, organized by category (pose references, locations, objects & props, architecture, costumes, lighting, mood, compositions) and collections, with per-asset AI-usage flags (background/environment, composition ref, lighting ref, style ref, texture/detail).
- **Reviewing** (`reviewing.png`) — annotation-based panel review: pinned markers on the image tied to comments/status (Needs Changes / Send Back / Approved), plus review-overview counts and quick actions.

Team/collaboration (online teammates, avatars, shared project) is part of the product.

## Stack

Next.js (App Router, TypeScript) + Tailwind CSS v4 + shadcn/ui (Radix base) + Zustand + Fabric.js for the canvas + Supabase (`@supabase/supabase-js`, client in `lib/supabase.ts`) for auth/db/storage. Deployed on Vercel; GitHub remote is `vinsu-hub/mangara`. See `.env.local.example` for the required Supabase env vars — copy to `.env.local` and fill in real values locally (never committed).

This is Milestone 0 of the build plan (skeleton + public deploy only) — no auth, canvas, or generation logic exists yet. Supabase client is wired but unused. See the full build-order plan (Milestones 0–5) discussed in-session for what comes next: auth, a saving canvas, the AI generation router (Gemini primary, Pollinations/HF fallback), and the reviewing loop.

**Live deploy:** https://mangara-iota.vercel.app (Vercel project `vince-tamis/mangara`, auto-deploys from `main` on push). **GitHub:** https://github.com/vinsu-hub/mangara.

## Relevant skills for this project

When working here, prefer these skills over ad hoc approaches:

- **frontend-design** — aesthetic direction and typography choices when building new UI; use for any screen work so it doesn't read as generic/templated.
- **apple-design** / **emil-design-eng** — for the fluid motion, spring interactions, and interaction polish this kind of creative tool benefits from (panel dragging, canvas manipulation, chat streaming).
- **composition-patterns** — if built in React, for the compound-component patterns this UI's inspector/editor panels will need.
- **react-best-practices** / **react-native-skills** — performance guidance depending on whether this ships web, native, or both.
- **codebase-research** — check existing patterns in this codebase before adding new ones, once code exists.
- **project-bootstrap** — for initial scaffolding (directory structure, tooling, linting, testing) when starting the actual build.
- **security-protocol** — this app has multi-user collaboration, file uploads, and AI generation endpoints — apply when building auth, uploads, or API routes.
- **webapp-testing** — for verifying UI behavior in-browser (Playwright) once there's a running app.
- **imagegen-frontend-web** — if generating further design reference images for screens not yet mocked up.
- **animation-vocabulary** / **find-animation-opportunities** — for naming/locating motion opportunities in the panel editor and chat UI.
- **code-review** / **quality-gate** — before considering any feature done.
- **dataviz** — only if/when usage stats, progress rings, or analytics charts (like the ones in Character Ref and Story Board) need real charting rather than static UI.

Skills above are global (`~/.claude/skills`) and are not copied into this repo.

## Project-scoped skills (`.claude/skills/`)

Installed here from external repos (2026-08-11), since they add capabilities not covered by the global skill set:

- **From [ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill):** `ui-ux-pro-max` (searchable UI/UX rules database — styles, palettes, font pairings, UX guidelines, motion presets), `design`, `design-system` (token architecture, component specs), `brand`, `ui-styling` (shadcn/ui + Tailwind), `banner-design`, `slides`.
- **From [everything-claude-code](https://github.com/worldflowai/everything-claude-code):** `backend-patterns`, `frontend-patterns`, `coding-standards`, `tdd-workflow`, `verification-loop`, `eval-harness`, `continuous-learning`, `strategic-compact`.

These take precedence over same-named global skills when working in this directory (most-specific-wins). Prefer `ui-ux-pro-max` / `design-system` over the global `frontend-design` for concrete UI decisions (color, type, spacing) in this project, since they carry an actual searchable rules database rather than general guidance.

Note: `adhd` and `taste-skill` (from [uditakhourii/adhd](https://github.com/uditakhourii/adhd) and [leonxlnx/taste-skill](https://github.com/leonxlnx/taste-skill)) were **not** installed as project skills — both are already available globally under the same names, so a project copy would just be a stale duplicate. The `taste-skill` repo also bundles several skills (brandkit, minimalist-skill, redesign-skill, soft-skill, stitch-skill, imagegen-frontend-web/mobile, image-to-code-skill, output-skill, gpt-tasteskill, brutalist-skill) that are likewise already global. `clickhouse-io` and `project-guidelines-example` from the other two repos were skipped as irrelevant noise (a database-specific skill and a generic template example, respectively).

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

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

Next.js 16 (App Router, TypeScript) · Tailwind v4 · shadcn/ui (radix-nova style) · Zustand · Fabric.js 7 · Supabase (auth/Postgres/Storage) · deployed on Vercel.

**Live:** https://mangara-iota.vercel.app (Vercel project `vince-tamis/mangara`, auto-deploys from `main`).
**GitHub:** https://github.com/vinsu-hub/mangara.
**Env:** copy `.env.local.example` → `.env.local`. `SUPABASE_SECRET_KEY` is server-only (never `NEXT_PUBLIC_`). `GEMINI_API_KEY` is optional — without it the generation router falls through to Pollinations, which needs no key.

## What exists

Auth (email/password, middleware-gated), a Fabric.js page editor (8 tools, panel/polygon/freeform shapes, split/merge, 6 manga layout templates, grid + snap + rulers + guides, alignment snapping, undo/redo, autosave, PNG export at 1x/2x), an async AI generation pipeline (queue → provider → Storage → panel, with a Gemini/Pollinations router), Story Board (chapters → scenes → beats, page ranges wired to real pages), and Character Ref (identity, consistency-lock sliders, AI-generated turnaround/expressions/poses, relationships).

**Not built:** Assets, Main Chat, Outputs, Prompt Studio, the Reviewing tab's annotation pins, mask tools, the Pen tool (registered but stubbed), and Character Ref's Design/Costumes/Appearance Lock sub-tabs. These render as honest stubs, not fake UI — keep it that way.

## Working on this project — read before you start

**Schema changes are a manual paste.** Only API keys are available here, never DB credentials, so `supabase/schema.sql` has to be pasted into the Supabase SQL Editor by the user. The file is idempotent and safe to re-run. Two hard constraints, both learned the painful way:
- **Never put `storage.*` DDL in it.** `storage.objects` is owned by `supabase_storage_admin`, so `create policy` on it fails — and because the SQL Editor runs the file in one transaction, that single error silently rolls back *every table above it*. Create buckets through the Storage API instead.
- **Never `drop function`.** Policies depend on the helper functions; dropping one fails outright. Use `create or replace`.

**Tests are the source of truth, not the build.** Seven Playwright suites live in `tests/`. Every significant bug in this project passed `npm run build` and was only caught by driving the running app. Run them with:

```
python scripts/with_server.py --server "npx next dev -p 3001" --port 3001 -- python tests/<name>.spec.py
```

They need `MANGARA_TEST_EMAIL` / `MANGARA_TEST_PASSWORD` for a confirmed account (`node --env-file=.env.local scripts/create-test-user.mjs` makes one — Supabase's free tier rate-limits confirmation emails hard, so don't sign up through the UI repeatedly).

Suites are idempotent: they assert on *deltas*, not absolute counts, and clean up after themselves. Keep that property — several were flaky until they did.

## Traps that have already bitten

- **Fabric v6+ defaults `originX/originY` to `center`.** Every geometry value here treats x/y as the top-left corner, so objects must opt into `originX: "left", originY: "top"`. Getting this wrong renders panels offset by half their size.
- **Autosave must not write server-owned columns.** `saveLayers` deliberately omits `image_url`, `generation_status` and `last_provider` — the generation pipeline owns those, and including them made the browser's stale copy clobber finished results.
- **`--font-sans` must not be self-referential.** It was, for most of this project's life, and every screen silently rendered in the browser's fallback serif. `tests/snapping.spec.py` guards it.

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

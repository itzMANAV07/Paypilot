- Work on ONE phase at a time from PLAN.md. Do not start the next phase.
- Before writing PayPal request bodies, read the official docs and follow the exact schema. Do not guess field names.
- The LLM must never call a tool that sends, pays, or changes money. Those are UI-triggered API routes.
- Validate all inputs with Zod on the server. Never trust LLM output.
- Never log or expose secrets. All env access goes through lib/env.ts.
- Keep files small and typed. No `any` unless commented.
- After each phase: run typecheck, lint, tests; then summarise what changed and how to verify it manually.
- Prefer boring, working code over clever abstractions. This is a 3-day hackathon.
- If something is ambiguous, ask me one short question instead of guessing.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

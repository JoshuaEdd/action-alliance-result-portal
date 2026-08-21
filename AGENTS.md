# Project Notes

## Git workflow
- Work happens on the `staging` branch; changes reach `main` via PRs from `staging`.
- Push commits to `origin staging` — never push directly to `main` unless explicitly asked.
- After pushing to staging, let the user open/merge the PR on GitHub, then deploy from `main` on Render.

## Deployment
- Single-host deploy on Render: root `npm run build` then `npm start` (serves API + built client).
- Render has no GitHub App connected → auto-deploy does not fire; deploys are manual.
- After schema changes in `server/src/db/schema.sql`, run `npm run migrate` in the Render Shell.

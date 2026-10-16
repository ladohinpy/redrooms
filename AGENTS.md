# Redrooms — instructions for AI coding agents

## Scope of this repository (2026-10-17)

Repository: https://github.com/ladohinpy/redrooms

**Current stage:** Telegram Serverless Mini App v06 with channel membership gate **@redrooms_stage**. We have implemented the first backend endpoint. The owner's goal is to distribute the Mini App **directly from Telegram**, hosted at `https://app<app_id>.tgcloud.ai/`, without requiring an external site or a local computer.

Read `README.md` and `docs/LAUNCH-TELEGRAM.md` before changing code. Old architecture in `docs/archive-v06/` is **historical** and does not override this stage.

## Architecture

- `public/index.html`: bundled original 3D game v06, 201 cassettes, 4 director tables, mobile controls, fullscreen/pause, scoring and local saves. Preserve all behavior.
- `public/access-gate.js`: fail-closed browser wrapper for `Telegram.WebApp.Serverless.call('checkAccess', ...)`.
- `tgcloud/endpoints/checkAccess.js`: uses *verified* `ctx.initData.user.id` and `api.getChatMember()` to check `@redrooms_stage`.
- `tgcloud/lib/subscription.js`: pure membership status interpretation.
- `tgcloud/schema.js`: deliberately empty; no SQLite tables.
- `tgcloud.jsonc`: static.source = `public`.
- `.github/workflows/publish.yml`: **manual targeted push** of exactly `tgcloud/lib/subscription.js`, `tgcloud/endpoints/checkAccess.js`, `public/`.

## Mandatory security and engineering rules

1. Never trust browser-sent Telegram user IDs, query parameters, localStorage or client `initDataUnsafe` as authentication. Endpoints must use verified `ctx.initData`.
2. The bot must be an administrator of `@redrooms_stage` for guaranteed `getChatMember` results. Handle API errors/unknown statuses by **denying entry and showing retry**, not by failing open.
3. The client gate is not server-side DRM or anti-cheat. Static assets are publicly retrievable. Do not claim scores are protected.
4. Do not add a database, schema tables, migrations, paid AI services, tracking, new game modes or handlers without an explicit new task.
5. Keep bot secrets and `TGCLOUD_TOKEN` out of Git, HTML, logs, issues, PRs and chat. GitHub Actions uses secret `TGCLOUD_TOKEN`.
6. Never run a plain/full `tgcloud push` without reviewing cloud module deletions. **Only use the targeted deploy** in the workflow. Never use `--force` as a conflict workaround.
7. No surprise deploys: make feature branches and PRs, run `npm run check` (including tests), wait for owner approval, and deploy manually from GitHub Actions. Do not edit BotFather settings automatically.
8. Do not add an echo `handlers/message.js` or take over an existing webhook. BotFather's Main Mini App is the launch surface, not a bot command handler.
9. Preserve all 201 original films, four directors, scene look/feel, mobile gesture handling, local progress and scoring mechanics. No wholesale refactors of the bundled `index.html`.
10. Keep the link to `@redrooms_stage` as an entrance requirement, not as the app hosting URL. `PLAYER_CONFIG.telegramAppUrl` stays empty until the real **bot** username is supplied; never invent a `t.me` bot link.

## Release acceptance

- Signed Telegram Mini App session for a channel member: join gate shows success and game launches.
- Non-member: game start disabled, shows join channel and recheck buttons; after subscribing and rechecking game launches.
- API error/invalid initData/browser without Telegram: no access, explanatory message.
- Real iOS and Android Mini App, fullscreen, pointer controls, join/return behavior tested manually.
- `npm run check` passes. PR lists files changed and test evidence; publish requires explicit owner decision.

Official documentation: https://core.telegram.org/bots/serverless and https://core.telegram.org/bots/webapps.

# Красная комната v06 — Telegram Mini App с проверкой подписки

Проект: https://github.com/ladohinpy/redrooms

Это **полная игра v06**: 3D-комната, 201 кассета и 4 стола режиссёров, сохранены управление, правила и локальный прогресс. Дополнено **проверкой входа на подписку на тестовый канал [@redrooms_stage](https://t.me/redrooms_stage)**. Serverless работает непосредственно на стороне Telegram; отдельного Python-сервера, хостинга, базы данных и SaleBot не нужно.

## Что уже в коде

| Путь | Назначение |
| --- | --- |
| `public/index.html` | Полная игра, экран подписки, вход только после подтверждения Serverless |
| `public/access-gate.js` | Вызов `Telegram.WebApp.Serverless.call('checkAccess')`; ошибки доступа не превращаются в пропуск |
| `tgcloud/endpoints/checkAccess.js` | Бот проверяет `ctx.initData.user.id` через Bot API `getChatMember` |
| `tgcloud/lib/subscription.js` | Разбор результатов Bot API (`member`/`left` и т.д.) |
| `tgcloud.jsonc` | Публикация папки `public` как Telegram Mini App |
| `tgcloud/schema.js` | Пустая схема; миграций и таблиц нет |
| `.github/workflows/check.yml` | Проверка каждого PR |
| `.github/workflows/publish.yml` | Ручная **адресная** публикация HTML + конкретных serverless-модулей |
| `AGENTS.md` | Правила и ограничения для AI-агента |
| `docs/LAUNCH-TELEGRAM.md` | **Отдельная пошаговая инструкция** настройки BotFather и ухода от Zindone |

**Начинайте с инструкции:** [docs/LAUNCH-TELEGRAM.md](docs/LAUNCH-TELEGRAM.md).

## Главное: адрес игры

В BotFather **не выбирают файл** `index.html`. После выполнения GitHub Action Telegram выдаст URL вида `https://app<app_id>.tgcloud.ai/`. Именно его указывают как URL **Main Mini App** у нужного бота вместо старого `zindone.ru`. Ссылка на канал `@redrooms_stage` — только для проверки подписки, **не URL игры**.

## Чего нет

Нет handler `/start`, БД, таблиц, рейтингов, серверных игровых сессий, AI в игре или периодического контроля подписки. Реальное содержимое `public/index.html` открыто для скачивания; это контроль входа через интерфейс, а не DRM/античит. Проверка происходит при открытии, а также повторно при возвращении из канала до старта партии.

## Команды для разработчиков (в облачном GitHub Codespaces, если нужно)

```bash
npm install
npm run check
# НЕ выполнять без намерения опубликовать:
# npx tgcloud push tgcloud/lib/subscription.js tgcloud/endpoints/checkAccess.js public/
```

Публикация уже описана в `.github/workflows/publish.yml` и вызывается вручную из GitHub Actions. В `Settings → Secrets and variables → Actions` должен быть секрет **`TGCLOUD_TOKEN`**, полученный из `@BotFather → Serverless → CLI Access → Access token`. Токен бота нигде в коде не хранится.

Документация старой сборки находится в `docs/archive-v06/` и может описывать предыдущую архитектуру с сервером рядом с `zindone.ru`. Она историческая; текущая архитектура описана в этой инструкции и `AGENTS.md`.

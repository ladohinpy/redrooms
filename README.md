# Красная комната v06 — Telegram Mini App

Стартовый репозиторий для https://github.com/ladohinpy/redrooms.

**Текущая цель — разместить готовую игру в Telegram Serverless без backend-логики.** Никакой проверки подписки, базы данных или обработчиков сообщений здесь пока нет. В `public/index.html` — полная статическая игра v06 из сохранённых материалов проекта (201 кассета, 4 режиссёра).

## Содержимое

| Путь | Назначение |
| --- | --- |
| `public/index.html` | Полная HTML/JS версия игры v06, готовая к статической публикации |
| `tgcloud.jsonc` | Telegram Serverless: публикует папку `public/` |
| `tgcloud/schema.js` | Пустая схема, таблиц нет |
| `tgcloud/handlers/`, `endpoints/`, `lib/` | Пустые папки для будущих задач; ничего сейчас не исполняют |
| `.github/workflows/check.yml` | Проверяет HTML, JS и состав каталога в PR |
| `.github/workflows/publish.yml` | Ручная публикация статических файлов в Telegram |
| `AGENTS.md` | Ограничения и правила для AI-кодеров |
| `docs/archive-v06/` | Сохранённая документация предыдущей игры, не инструкции к новому backend |

## 1. Загрузить в GitHub без терминала

1. Распаковать архив на компьютере (устанавливать программы разработки не надо).
2. Открыть https://github.com/ladohinpy/redrooms.
3. В пустом репозитории выбрать **uploading an existing file** или **Add file → Upload files**.
4. Перенести **содержимое** распакованной папки (а не ZIP как один файл) в корень репозитория и нажать **Commit changes**.
5. Проверить, что видны `public/`, `tgcloud/`, `.github/`, `AGENTS.md`, `tgcloud.jsonc`, `package.json`.

Если браузер не даёт загрузить каталоги / скрытую `.github`, используйте **Code → Codespaces → Create codespace** (это редактор в облаке). Не нужно работать в локальном терминале.

## 2. Подключить уже включённый Telegram Serverless

1. В `@BotFather`: выбрать нужного бота → **Serverless → CLI Access → Access token**.
2. В GitHub: **Settings → Secrets and variables → Actions → New repository secret**.
3. Название: `TGCLOUD_TOKEN`; значение: CLI access token (`app<id>:<secret>`). Сохранить. Никогда не помещать токен в исходники, Issues, PR и переписку.
4. В GitHub вкладка **Actions** → workflow **Publish Mini App (manual)** → **Run workflow** на ветке `main`.
5. Дождаться успешного выполнения и открыть адрес `https://app<app_id>.tgcloud.ai/`, который напечатает `tgcloud push` в логах. Если пользовательские действия не видны — проверьте, что workflow разрешён GitHub Actions и секрет создан.
6. В BotFather в настройках **Main Mini App** назначить этот HTTPS-адрес (точное место зависит от интерфейса BotFather).
7. Открыть Mini App через бота Telegram и проверить игру на телефоне.

**Важно:** workflow выполняет `tgcloud push public/`, а не полный `tgcloud push`: он не удаляет существующие handlers/endpoints и не меняет базу данных. До первого запуска убедитесь, что указанный BotFather токен относится к нужному тестовому/боевому боту.

## 3. Работа через Pull Request

- Каждую новую задачу AI делает в отдельной ветке и открывает PR.
- Workflow **Check Mini App** проверяет синтаксис JS, JSON и наличие каталога 201/4.
- После одобрения и merge в `main` владелец вручную запускает **Publish Mini App (manual)**.
- Нет автопубликации от push в `main`. Публикацию можно отключить в GitHub Actions.

## 4. Проверка без Telegram

Из терминала в Codespaces (по желанию):

```bash
node scripts/check-app.mjs
```

Можно открыть `public/index.html` локально обычным браузером; однако это не проверяет Telegram fullscreen/встраивание и поведение на реальных телефонах.

## Не реализовано в этой поставке

- Защита входа подпиской (`getChatMember`), серверные игровые сессии и рейтинг.
- Handler `/start`, который отправляет сообщение с кнопкой Mini App. Для входа используем **Main Mini App**, назначаемый в BotFather.
- Управление каналами и отдельное администрирование.
- Telegram API-эндпоинты, база данных, OAuth и AI внутри игры.

После первого успешного запуска следующий отдельный этап — проверка подписки. Архивный набросок лежит в `docs/archive-v06/BOT-MECHANISM.md` и требует адаптации под Telegram Serverless.

## Ссылки

- Telegram Serverless: https://core.telegram.org/bots/serverless
- GitHub Actions Secrets: https://docs.github.com/en/actions/security-for-github-actions/security-guides/using-secrets-in-github-actions
- Настройки Telegram Mini Apps: https://core.telegram.org/bots/webapps

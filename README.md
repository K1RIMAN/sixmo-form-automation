# Sixmo Form Automation

> Автоматическое прохождение многошаговой веб-формы [sixmo.ru](https://sixmo.ru/) (Adaptive Flow Challenge) с поддержкой вызова через AI-агента как MCP tool.

---

## Что это

Браузерная автоматизация на базе **Playwright**, которая:

- проходит форму от начала до конца за ~20 секунд
- загружает файл на нужном шаге (`.txt`, `.md`, `.json`)
- работает с **динамическими полями** — имена, порядок и CSS-классы меняются при каждом запуске
- обходит **anti-bot защиту** (FingerprintJS, webdriver detection, поведенческая телеметрия)
- обрабатывает **промежуточные loading-состояния** ("Этап N подготавливается")
- возвращает сгенерированный идентификатор

Решение оформлено как **MCP Tool Server** — вызывается через Claude Code или любого другого MCP-совместимого агента.

---

## Быстрый старт

```bash
git clone <repo-url> && cd sixmo-form-automation
npm install
npx playwright install chromium
```

### Запуск через CLI

```bash
# Headless (по умолчанию)
node src/cli.js

# С видимым браузером (для отладки)
node src/cli.js --visible

# С пользовательскими данными и файлом
node src/cli.js --file ./resume.txt --field logic_mode="Квантовый" --field favorite_color="Синий"

# Bulk-данные через JSON
node src/cli.js -d '{"shape_signal":"Треугольник"}' --file ./data.json
```

### Пример вывода

```
[sixmo] Navigating to https://sixmo.ru
[sixmo] Clicked start

── Step 1 ──
[sixmo]   ⏳ Step is preparing, waiting...
[sixmo] Fields: favorite_color(text), logic_mode(text), orbital_path(select)
[sixmo]   ✎ Type "Синий" → favorite_color
[sixmo]   ✎ Type "Квантовый" → logic_mode
[sixmo]   ▼ Select "arc-lumen" → orbital_path (3 options)
[sixmo]   → Submitted
[sixmo]   → Navigated to https://sixmo.ru/#/flow/.../step/2

── Step 2 ──
[sixmo]   ⏳ Step is preparing, waiting...
[sixmo] Fields: artifact_file(file), tempo_choice(select), shape_signal(text)
[sixmo]   ↑ Upload "resume.txt" → artifact_file
[sixmo]   ▼ Select "glide" → tempo_choice (3 options)
[sixmo]   ✎ Type "Треугольник" → shape_signal
[sixmo]   → Submitted

═══ RESULT ═══
[sixmo] Identifier: 4C13948DF520
[sixmo] Flow:       3ecc32033dd922b6efa9af82
[sixmo] Completed:  2026-03-19 17:09:31 UTC
```

---

## Вызов через AI-агента (MCP Tool)

Проект включает MCP-сервер (JSON-RPC 2.0 over stdio), который позволяет AI-агенту вызывать автоматизацию как инструмент `fill_sixmo_form`.

### Регистрация

Файл `.mcp.json` в корне проекта уже настроен:

```json
{
  "mcpServers": {
    "sixmo-form": {
      "command": "node",
      "args": ["src/mcp-server.js"],
      "cwd": "."
    }
  }
}
```

### Параметры tool

| Параметр | Тип | По умолчанию | Описание |
|-----------|------|-------------|----------|
| `form_data` | `object` | `{}` | Пары `field_name → value`. Неизвестные поля заполняются автоматически |
| `file_path` | `string` | авто | Путь к файлу для загрузки (`.txt`, `.md`, `.json`) |
| `headless` | `boolean` | `true` | Запуск без видимого окна браузера |

### Программный вызов (Node.js)

```javascript
const { automateForm } = require("./src/automate-form");

const result = await automateForm({
  formData: { logic_mode: "Квантовый", favorite_color: "Синий" },
  filePath: "./resume.txt",
  headless: true,
});

// result.identifier → "4C13948DF520"
// result.flowId     → "3ecc32033dd922b6efa9af82"
// result.completedAt → "2026-03-19 17:09:31 UTC"
// result.url        → "https://sixmo.ru/#/flow/.../result"
```

---

## Архитектура

```
src/
├── automate-form.js   Ядро: Playwright + stealth → заполнение → результат
├── cli.js             CLI-обёртка с парсингом аргументов
└── mcp-server.js      MCP tool server (JSON-RPC 2.0 / stdio)
```

### Как работает форма (API)

```
POST /api/start.php          →  { flowId, flowKey, csrfToken }
GET  /api/step.php?step=N    →  { fields[], stepToken, domSeed }  (может быть status: "pending")
POST /api/submit.php         →  multipart/form-data + telemetry JSON
GET  /api/result.php         →  итоговый идентификатор
```

### Обход anti-bot

| Защита | Решение |
|--------|---------|
| `navigator.webdriver` | `addInitScript` → `false` |
| `__playwright__binding__` | `Object.defineProperty` с trap'ом на setter |
| `window.chrome.runtime` | Спуф объекта с `connect()`, `sendMessage()` |
| FingerprintJS v4.6.2 | `playwright-extra` + `puppeteer-extra-plugin-stealth` |
| Поведенческая телеметрия | Генерация реалистичных keystroke intervals, mouse moves, dwell time |
| Рандомизация CSS/DOM | Поиск полей по `[data-field-key]` (стабильный атрибут) |
| Loading-состояние между шагами | Polling с проверкой "подготавливается" + сравнение имён полей |

---

## Технологии

- **Node.js** — рантайм
- **[Playwright](https://playwright.dev/)** + **[playwright-extra](https://github.com/nickytonline/playwright-extra)** — браузерная автоматизация
- **[puppeteer-extra-plugin-stealth](https://github.com/nickytonline/puppeteer-extra-plugin-stealth)** — обход детекции
- **[MCP](https://modelcontextprotocol.io/)** — протокол интеграции с AI-агентами

---

## CLI Reference

```
node src/cli.js [options]

Options:
  --file, -f <path>       Файл для загрузки (.txt, .md, .json)
  --field <key=value>     Значение поля (можно несколько раз)
  --data, -d <json>       JSON-объект с данными полей
  --visible, --headed     Показать окно браузера
  --headless              Скрытый режим (по умолчанию)
  --timeout, -t <ms>      Таймаут в миллисекундах (по умолчанию 60000)
```

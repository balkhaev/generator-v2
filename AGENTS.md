# Project Agent Guide

## Parallel Agents (CRITICAL)

В этом репозитории несколько агентов могут одновременно работать в **одном worktree и одной ветке**. Действуй изолированно, не трогай чужое состояние.

**Запрещено:**

- `git stash` / `git stash pop` — может затереть незакоммиченные изменения другого агента.
- `git checkout -- <file>`, `git restore <file>`, `git reset --hard`, `git clean -fd` по файлам, которые ты сам не редактировал в этой сессии.
- Удалять или откатывать untracked файлы (`?? ...` в `git status`) — это работа параллельного агента.
- Делать `git add -A` / `git commit -a` без явного списка файлов. Только `git add <конкретные пути, которые ты менял>`.
- Переключать ветку (`git checkout <branch>`, `git switch`) без явной просьбы пользователя.
- Запускать форматтеры/линтеры/кодогенераторы (`ultracite fix`, `drizzle-kit generate`, `prisma generate`, массовые codemod) по всему репо. Только по своим файлам: `bun x ultracite fix <paths>`.

**Обязательно:**

- Перед стартом — `git status`, чтобы увидеть чужие правки и untracked файлы. Считай их «чужой территорией».
- Список своих изменений веди явно: что отредактировал — то и трогаешь дальше.
- Type-check / lint ошибки в файлах, которые ты не менял, **игнорируй** — это не твой контекст.
- Если нужно временно убрать чужие правки, чтобы что-то проверить — НЕ делай этого. Работай поверх или попроси пользователя.
- Откатывать можно **только** свои правки текущей сессии, и только если ты их сам сломал.

Цель: ни одна команда агента не должна приводить к потере чужой незакоммиченной работы.

---

## Deploy

Пуш в ветку `main` (репо `balkhaev/generator-v2`) автоматически триггерит деплой всех сервисов через Coolify. Отдельный ручной деплой не нужен.

- Слил PR/закоммитил в `main` → Coolify пересобирает и раскатывает затронутые приложения. Изменения в `apps/mcp` (например новые MCP-тулы) становятся доступны после этого автодеплоя.
- Ручной `coolify.deploy` / `redeploy_project` нужен только для форс-передеплоя без коммита (например после правки env через `coolify.env_vars`).
- Runtime-config / env-правки в проде применяются без деплоя — через MCP (`prompt_enhance_set`, `training_provider_set`, `coolify.env_vars` + `coolify.control restart`).

## Self-Debug Through MCP

В проекте уже есть MCP-инфраструктура для диагностики. Любой дебаг сервисов, прода, инференса, авторизации, Kafka, деплоев и окружения начинается через MCP, а не через разовые ручные команды.

Система должна сама себя дебажить через MCP. У агента два слоя инструментов:

1. **Project MCP** — `apps/mcp` (HTTP `POST /mcp`, bearer `MCP_AUTH_TOKEN`, порт `3010`) + `packages/debug-tools` (stdio + bundle CLI). Тулы: health/`service_request`, generator workflows + execution submit/sync, test users (`test_user_upsert`/`test_user_get`), Kafka (cluster/topics/offsets/consumer groups/sample), prompt-enhance провайдер/модель (`prompt_enhance_get`/`prompt_enhance_set` для studio/persons "Enhance" / "Enhance for image"), `collect_debug_bundle`.
2. **Coolify MCP** (`user-balkhaev-coolify`) — прод: `find_issues`, `get_infrastructure_overview`, `list_applications`, `diagnose_app`, `application_logs`, `diagnose_server`, `server_resources`, `deployment` (get/list/cancel), `deploy`, `redeploy_project`, `restart_project_apps`, `control`, `env_vars`, `bulk_env_update`.

Project MCP знает «как должно быть», Coolify — «что реально крутится». Дебаг = свести две картины.

Канонический self-debug loop (подробно в скиле `mcp-debug`):

1. **Снять прод** — `coolify.find_issues` → `coolify.diagnose_app` → `coolify.application_logs` (`lines: 500` для редких ошибок); для упавшей сборки — `coolify.deployment list_for_app` → `deployment get`.
2. **Сравнить с эталоном** — повторить путь запроса локально через `project.service_request` (с `x-debug-correlation-id`); для inference — `generator_execution_submit`; для auth — `test_user_upsert`; для шины — `kafka_consumer_group_describe`.
3. **Развести причину** — код / env / инфраструктура. Env diff: `coolify.env_vars action: "list"` против локального `.env`.
4. **Применить фикс** — код через PR + `coolify.deploy` / `redeploy_project`; env через `coolify.env_vars` или `bulk_env_update` + `coolify.control restart`.
5. **Подтвердить** — `coolify.application_logs` после рестарта (нет паттерна ошибки) + `coolify.find_issues` (запись по сервису исчезла) + `project.service_health`.
6. **Закрепить** — если симптом ловили вручную или склеивали несколько `application_logs`, оформи это новым tool в project MCP (composite/обёрточный над Coolify API), чтобы следующий агент нашёл за один вызов.

Правила:

- MCP-first обязателен: сначала ищи и вызывай подходящий tool в Project MCP или Coolify MCP, и только если подходящего tool нет — добавляй его в MCP.
- Никаких ручных `curl`, `psql`, `kafkacat`, `ssh`, `docker logs`, прямого деплоя через панельку Coolify — всё через MCP, чтобы каждый шаг был воспроизводим следующим агентом.
- Если нужного тула нет — **расширяй MCP**. Project MCP правится в `apps/mcp/src/app.ts` (схема в `toolDefinitions`, хендлер, парсинг через хелперы, `createToolResult`, тест в `apps/mcp/src/app.test.ts`, `bun x ultracite fix`, `bun --cwd apps/mcp run check-types && bun test apps/mcp`). Coolify «расширяется» обёрточным tool в `apps/mcp` (домен `coolify_*`), который ходит в Coolify API и возвращает агрегированный ответ.
- После добавления нового тула обнови `docs/debugging-toolchain.md`.
- Корреляция между сервисами — через `x-debug-correlation-id`.

Подробнее: скилы `mcp-debug` (политика, self-debug loop, расширение), `backend-debug` (admin/generator/studio/persons), `inference-debug` (workflow → артефакт), `docs/debugging-toolchain.md`.

---

# Ultracite Code Standards

This project uses **Ultracite**, a zero-config preset that enforces strict code quality standards through automated formatting and linting.

## Quick Reference

- **Format code**: `bun x ultracite fix`
- **Check for issues**: `bun x ultracite check`
- **Diagnose setup**: `bun x ultracite doctor`

Biome (the underlying engine) provides robust linting and formatting. Most issues are automatically fixable.

---

## Core Principles

Write code that is **accessible, performant, type-safe, and maintainable**. Focus on clarity and explicit intent over brevity.

### Type Safety & Explicitness

- Use explicit types for function parameters and return values when they enhance clarity
- Prefer `unknown` over `any` when the type is genuinely unknown
- Use const assertions (`as const`) for immutable values and literal types
- Leverage TypeScript's type narrowing instead of type assertions
- Use meaningful variable names instead of magic numbers - extract constants with descriptive names

### Modern JavaScript/TypeScript

- Use arrow functions for callbacks and short functions
- Prefer `for...of` loops over `.forEach()` and indexed `for` loops
- Use optional chaining (`?.`) and nullish coalescing (`??`) for safer property access
- Prefer template literals over string concatenation
- Use destructuring for object and array assignments
- Use `const` by default, `let` only when reassignment is needed, never `var`

### Async & Promises

- Always `await` promises in async functions - don't forget to use the return value
- Use `async/await` syntax instead of promise chains for better readability
- Handle errors appropriately in async code with try-catch blocks
- Don't use async functions as Promise executors

### React & JSX

- Use function components over class components
- Call hooks at the top level only, never conditionally
- Specify all dependencies in hook dependency arrays correctly
- Use the `key` prop for elements in iterables (prefer unique IDs over array indices)
- Nest children between opening and closing tags instead of passing as props
- Don't define components inside other components
- Use semantic HTML and ARIA attributes for accessibility:
  - Provide meaningful alt text for images
  - Use proper heading hierarchy
  - Add labels for form inputs
  - Include keyboard event handlers alongside mouse events
  - Use semantic elements (`<button>`, `<nav>`, etc.) instead of divs with roles

### Error Handling & Debugging

- Remove `console.log`, `debugger`, and `alert` statements from production code
- Throw `Error` objects with descriptive messages, not strings or other values
- Use `try-catch` blocks meaningfully - don't catch errors just to rethrow them
- Prefer early returns over nested conditionals for error cases

### Code Organization

- Keep functions focused and under reasonable cognitive complexity limits
- Extract complex conditions into well-named boolean variables
- Use early returns to reduce nesting
- Prefer simple conditionals over nested ternary operators
- Group related code together and separate concerns

### Security

- Add `rel="noopener"` when using `target="_blank"` on links
- Avoid `dangerouslySetInnerHTML` unless absolutely necessary
- Don't use `eval()` or assign directly to `document.cookie`
- Validate and sanitize user input

### Performance

- Avoid spread syntax in accumulators within loops
- Use top-level regex literals instead of creating them in loops
- Prefer specific imports over namespace imports
- Avoid barrel files (index files that re-export everything)
- Use proper image components (e.g., Next.js `<Image>`) over `<img>` tags

### Framework-Specific Guidance

**Next.js:**

- Use Next.js `<Image>` component for images
- Use `next/head` or App Router metadata API for head elements
- Use Server Components for async data fetching instead of async Client Components

**React 19+:**

- Use ref as a prop instead of `React.forwardRef`

**Solid/Svelte/Vue/Qwik:**

- Use `class` and `for` attributes (not `className` or `htmlFor`)

---

## Testing

- Write assertions inside `it()` or `test()` blocks
- Avoid done callbacks in async tests - use async/await instead
- Don't use `.only` or `.skip` in committed code
- Keep test suites reasonably flat - avoid excessive `describe` nesting

## When Biome Can't Help

Biome's linter will catch most issues automatically. Focus your attention on:

1. **Business logic correctness** - Biome can't validate your algorithms
2. **Meaningful naming** - Use descriptive names for functions, variables, and types
3. **Architecture decisions** - Component structure, data flow, and API design
4. **Edge cases** - Handle boundary conditions and error states
5. **User experience** - Accessibility, performance, and usability considerations
6. **Documentation** - Add comments for complex logic, but prefer self-documenting code

---

Most formatting and common issues are automatically fixed by Biome. Run `bun x ultracite fix` before committing to ensure compliance.

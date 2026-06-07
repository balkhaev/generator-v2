# E2E Scripts

Самостоятельные скрипты для ручного/интеграционного E2E-прогона против живого
`generator-api`.

Не импортируются из продакшен-кода и не участвуют в `turbo build`/`bun test`.
Запускаются прямо через `bun run`, например:

```bash
bun run tools/e2e/prod-persons-e2e.ts
```

# E2E Scripts

Самостоятельные скрипты для ручного/интеграционного E2E-прогона против живого
`generator-api` и провайдера Fal.

Не импортируются из продакшен-кода и не участвуют в `turbo build`/`bun test`.
Запускаются прямо через `bun run`, например:

```bash
FAL_KEY=xxx bun run tools/e2e/fal-full-e2e.ts
FAL_KEY=xxx bun run tools/e2e/ltx-23-i2v-person-lora-e2e.ts
# только LTX (уже есть публичные URL картинки и LoRA):
FAL_KEY=xxx IMAGE_URL=https://... LORA_URL=https://... bun run tools/e2e/ltx-23-i2v-person-lora-e2e.ts
FAL_KEY=xxx bun run tools/e2e/zit-full-e2e.ts
FAL_KEY=xxx bun run tools/e2e/zit-step5-rerun.ts
bun run tools/e2e/prod-persons-e2e.ts
```

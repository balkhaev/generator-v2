export const PROMPT_ENHANCE_PROVIDER_NAMES = ["grok", "openrouter"];
/**
 * Discriminator for which surface a prompt-enhance setting belongs to. Each
 * surface owns an independent runtime-config domain so studio and persons
 * can run on different LLMs (e.g. studio on Qwen, persons on Grok).
 */
export const PROMPT_ENHANCE_TARGETS = ["studio", "persons"];

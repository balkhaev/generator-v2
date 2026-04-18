export interface PromptEnhanceClient {
	enhancePrompt(prompt: string): Promise<string>;
	enhancePromptWithImage(prompt: string, imageUrl: string): Promise<string>;
}

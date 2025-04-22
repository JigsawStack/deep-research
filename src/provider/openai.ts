/**
 * OpenAI provider
 */
import { createOpenAI, OpenAIProviderSettings } from "@ai-sdk/openai";
import { generateText } from "ai";
export class OpenAIProvider {
    private static instance: OpenAIProvider;
    private openai;

    private constructor(settings: OpenAIProviderSettings) {
        this.openai = createOpenAI({
            apiKey: settings.apiKey || '',
        });
    }

    public static getInstance(settings: OpenAIProviderSettings): OpenAIProvider {
        if (!OpenAIProvider.instance) {
            OpenAIProvider.instance = new OpenAIProvider(settings);
        }
        return OpenAIProvider.instance;
    }

    async generateText(prompt: string, model: string): Promise<string> {
        const result = await generateText({
            model: this.openai(model),
            prompt: prompt,
        });
        return result.text;
    }
}
import { GoogleGenerativeAIProvider, GoogleGenerativeAIProviderSettings, createGoogleGenerativeAI, google } from "@ai-sdk/google";
import { generateText } from "ai";

export class GeminiProvider {
  private client: GoogleGenerativeAIProvider;
  private static instance: GeminiProvider;

  private constructor(settings: GoogleGenerativeAIProviderSettings) {
    this.client = createGoogleGenerativeAI({
      apiKey: settings.apiKey,
      ...settings
    });
  }

  public static getInstance(settings: GoogleGenerativeAIProviderSettings): GeminiProvider {
    if (!GeminiProvider.instance) {
      GeminiProvider.instance = new GeminiProvider(settings);
    }
    return GeminiProvider.instance;
  }

  async generateText(prompt: string, model: string): Promise<string> {
    const result = await generateText({
      model: this.client(model),
      prompt: prompt,
    });
    return result.text;
  }
}

export default GeminiProvider;

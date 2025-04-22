import { DeepInfraProvider, DeepInfraProviderSettings, createDeepInfra } from "@ai-sdk/deepinfra";
import { generateText } from "ai";

export class DeepSeekProvider {
  private client: DeepInfraProvider;
  private static instance: DeepSeekProvider;

  private constructor(settings: DeepInfraProviderSettings) {
    this.client = createDeepInfra({
      apiKey: settings.apiKey,
      ...settings
    });
  }

  public static getInstance(settings: DeepInfraProviderSettings): DeepSeekProvider {
    if (!DeepSeekProvider.instance) {
      DeepSeekProvider.instance = new DeepSeekProvider(settings);
    }
    return DeepSeekProvider.instance;
  }

  async generateText(prompt: string, model: string): Promise<string> {
    const result = await generateText({
      model: this.client(model),
      prompt: prompt,
    });
    return result.text;
  }
}

export default DeepSeekProvider;

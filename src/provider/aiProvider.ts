import { createDeepInfra } from "@ai-sdk/deepinfra";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { LanguageModelV1, ProviderV1 } from "@ai-sdk/provider";
import { generateText } from "ai";

/**
 * AIProvider acts as an abstract factory for different AI model providers
 * It unifies the interface for interacting with different provider types
 */

export type ModelType = "default" | "reasoning" | "output" | string;

export class AIProvider {
  private providers: Map<string, ProviderV1> = new Map();
  private models: {
    default: LanguageModelV1;
    reasoning: LanguageModelV1;
    output: LanguageModelV1;
  };

  /**
   * Initialize the provider with API keys from config and optional custom models
   */
  constructor({
    OPENAI_API_KEY,
    GEMINI_API_KEY,
    DEEPINFRA_API_KEY,
    defaultModel,
    reasoningModel,
    outputModel,
  }: {
    OPENAI_API_KEY: string;
    GEMINI_API_KEY: string;
    DEEPINFRA_API_KEY: string;
    defaultModel: LanguageModelV1;
    reasoningModel: LanguageModelV1;
    outputModel: LanguageModelV1;
  }) {
    // Check for required API keys
    if (!OPENAI_API_KEY || !GEMINI_API_KEY || !DEEPINFRA_API_KEY) {
      throw new Error("Missing required API keys. Please provide OPENAI_API_KEY, GEMINI_API_KEY, and DEEPINFRA_API_KEY.");
    }

    // Initialize providers
    const openai = createOpenAI({
      apiKey: OPENAI_API_KEY,
    });

    const gemini = createGoogleGenerativeAI({
      apiKey: GEMINI_API_KEY,
    });

    const deepinfra = createDeepInfra({
      apiKey: DEEPINFRA_API_KEY,
    });

    // Store providers
    this.providers.set("openai", openai);
    this.providers.set("gemini", gemini);
    this.providers.set("deepinfra", deepinfra);

    // Set default models
    this.models = {
      default: defaultModel,
      reasoning: reasoningModel,
      output: outputModel,
    };
  }

  getModel(key: ModelType) {
    return this.models[key];
  }

  setModel(key: ModelType, model: LanguageModelV1) {
    this.models[key] = model;
  }

  /**
   * Get a specific provider by name
   */
  getProvider(name: string): ProviderV1 | undefined {
    return this.providers.get(name);
  }

  /**
   * Generate text using a specified model
   * For reasoning models, this will extract the reasoning property or <thinking> content if available
   */
  async generateText(prompt: string, model: LanguageModelV1 = this.models.default): Promise<string> {
    try {
      const result = await generateText({
        model,
        prompt,
      });

      // First check if reasoning property exists (for models like deepseek-reasoner)
      if ("reasoning" in result && result.reasoning) {
        return result.reasoning;
      }

      // Then check for <thinking> tags in the text output
      if (result.text && result.text.includes("<thinking>")) {
        const thinkingMatch = result.text.match(/<thinking>(.*?)<\/thinking>/s);
        if (thinkingMatch && thinkingMatch[1]) {
          return thinkingMatch[1].trim();
        }
      }

      // Default fallback to regular text output
      return result.text;
    } catch (error) {
      throw new Error(`Error generating text: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

export default AIProvider;

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
}

export default AIProvider;

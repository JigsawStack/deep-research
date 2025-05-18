import createDeepResearch from "../..";
import "dotenv/config";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createDeepInfra } from "@ai-sdk/deepinfra";

// Basic usage example
async function basicResearch() {
  // Check for required API keys
  if (!process.env.OPENAI_API_KEY || !process.env.GEMINI_API_KEY || !process.env.DEEPINFRA_API_KEY || !process.env.JIGSAW_API_KEY) {
    console.error("Error: API keys are required for all models.");
    console.error("Please set OPENAI_API_KEY, GEMINI_API_KEY, and DEEPINFRA_API_KEY in your environment variables.");
    process.exit(1);
  }

  const gemini = createGoogleGenerativeAI({
    apiKey: process.env.GEMINI_API_KEY,
  });

  const deepinfra = createDeepInfra({
    apiKey: process.env.DEEPINFRA_API_KEY,
  });

  // Get model instances
  const geminiModel = gemini("gemini-2.0-flash");
  const deepseekModel = deepinfra("deepseek-ai/DeepSeek-R1");

  // Create instance using the factory function with default model assignments
  const deepResearch = createDeepResearch({
    depth: {
      maxLevel: 3, // Detailed analysis
    },
    breadth: {
      maxParallelTopics: 10,
    },
    report: {
      maxOutputTokens: 50000, // Hard upper limit of tokens
      targetOutputTokens: 15000,
    },
    models: {
      output: geminiModel,
      reasoning: deepseekModel,
    },
    // Pass API keys from environment variables to config
    openaiApiKey: process.env.OPENAI_API_KEY,
    geminiApiKey: process.env.GEMINI_API_KEY,
    deepInfraApiKey: process.env.DEEPINFRA_API_KEY,
    jigsawApiKey: process.env.JIGSAW_API_KEY,
  });

  // Need to provide prompts array as required by generate method
  const prompts = ["what is love?"];

  try {
    console.log("Starting deep research...");
    const result = await deepResearch.generate(prompts[0]);
    // const result = await deepResearch.testGenerate();

    // Log research results
    console.log("\n=== RESEARCH SUMMARY ===");
    console.log(`Research completed successfully: ${result}`);

    return result;
  } catch (error) {
    console.error("Research failed with error:", error);
    process.exit(1);
  }
}

// Run the research
basicResearch();

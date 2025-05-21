import "dotenv/config";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createDeepInfra } from "@ai-sdk/deepinfra";
import { createDeepResearch } from "../../src/index";

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
    report: {
      maxOutputTokens: 5000, // Hard upper limit of tokens
    },
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    DEEPINFRA_API_KEY: process.env.DEEPINFRA_API_KEY,
    JIGSAW_API_KEY: process.env.JIGSAW_API_KEY,
  });

  // Need to provide prompts array as required by generate method
  // const topic = "Which condition of Arrhenius's sixth impossibility theorem do critical-level views violate? Answer Choices: A. Egalitarian Dominance B. General Non-Extreme Priority C. Non-Elitism D. Weak Non-Sadism E. Weak Quality Addition";
  // const topic = "What is meaning of pi?"
  // const topic = "how many samples does PAROT-360V have, it's a benchmark"
  const topic = "What is the largest order of a non-cyclic torsion subgroup of an elliptic curve over $\\mathbb{Q}(\\sqrt{-3})$"

  try {
    console.log("Starting deep research...");
    const result = await deepResearch.generate(topic);
    // const result = await deepResearch.testGenerate();
    console.log("result", result.data.text);

    return result;
  } catch (error) {
    console.error("Research failed with error:", error);
    process.exit(1);
  }
}

// Run the research
basicResearch();

import "dotenv/config";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createDeepInfra } from "@ai-sdk/deepinfra";
import { createDeepResearch, generateFinalReport, mapSearchResultsToNumbers } from "../../src/index";
import fs from "fs";

// Basic usage example
async function testFinalReport() {
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
      targetOutputTokens: 40000,
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
  const topic = "how to make a billion dollars";

  const sources = JSON.parse(fs.readFileSync("logs/sources.json", "utf-8"));
  const targetOutputTokens = deepResearch.config.report.targetOutputTokens;
  const latestResearchPlan = JSON.parse(fs.readFileSync("logs/researchPlan.json", "utf-8"));
  const latestReasoning = JSON.parse(fs.readFileSync("logs/reasoning.json", "utf-8"));
  const queries = JSON.parse(fs.readFileSync("logs/queries.json", "utf-8"));

  const numberedSources = mapSearchResultsToNumbers({ sources });

  // Generate the final report using the loaded data
  const { report, debugLog } = await generateFinalReport({
    sources: numberedSources,
    topic,
    targetOutputTokens,
    aiProvider: deepResearch.aiProvider,
    debugLog: [],
    latestResearchPlan,
    latestReasoning,
    queries,
  });

  fs.writeFileSync("logs/testReport.md", report);
  fs.writeFileSync("logs/testDebugLog.md", debugLog.join("\n"));

}

// Run the research
testFinalReport();

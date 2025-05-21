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
    report: {
      maxOutputTokens: 30000, // Hard upper limit of tokens
      targetOutputTokens: 20000,
    },
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    DEEPINFRA_API_KEY: process.env.DEEPINFRA_API_KEY,
    JIGSAW_API_KEY: process.env.JIGSAW_API_KEY,
  });

  // Need to provide prompts array as required by generate method
  const topic = "Which condition of Arrhenius's sixth impossibility theorem do critical-level views violate? Answer Choices: A. Egalitarian Dominance B. General Non-Extreme Priority C. Non-Elitism D. Weak Non-Sadism E. Weak Quality Addition";
  // const topic = "What is meaning of pi?"
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

  fs.writeFileSync("logs/testFinalReport.md", report);
  fs.writeFileSync("logs/report-log.md", debugLog.join("\n"));

}

// Run the research
testFinalReport();

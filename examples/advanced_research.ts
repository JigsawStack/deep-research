import "dotenv/config";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { createDeepResearch } from "../src/index";

// Advanced usage example
async function advancedResearch() {
  // initialize your own AiProviders
  const gemini = createGoogleGenerativeAI({
    apiKey: process.env.GEMINI_API_KEY,
  });

  const openRouterProvider = createOpenRouter({
    apiKey: process.env.OPENROUTER_API_KEY,
  });

  const openaiProvider = createOpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  const advancedResearch = createDeepResearch({
    max_output_tokens: 30000, // Hard upper limit of tokens
    target_output_tokens: 10000,
    max_depth: 4, // specify how many iterations of research to perform (how deep the research should be)
    max_breadth: 3, // specify how many subqueries to generate (how broad the research should be)
    // logging: {
    //   enabled: true, // enabled to true for console logging
    // },
  });

  // the prompt to research
  const prompt = "Who is harsha vardhan khurdula, what could his emails be? namely school and work?";

  try {
    const advancedResult = await advancedResearch.generate(prompt); // generate runs the research pipeline

    console.log("advancedResult", advancedResult.data.text);
    console.log("advancedBibliography", advancedResult.data.bibliography);
    console.log("advancedTokenUsage", advancedResult._usage);
  } catch (error) {
    console.error("Research failed with error:", error);
    process.exit(1);
  }
}

// Run the research
advancedResearch();

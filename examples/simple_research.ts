import "dotenv/config";
import { createDeepResearch } from "../src/index";

// Basic usage example
async function simpleResearch() {
  // Create instance using the factory function with default model assignments
  const simpleResearch = createDeepResearch({
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    DEEPINFRA_API_KEY: process.env.DEEPINFRA_API_KEY,
    JIGSAW_API_KEY: process.env.JIGSAW_API_KEY,
  });

  // the prompt to research
  const prompt = "What is the largest order of a non-cyclic torsion subgroup of an elliptic curve over $\\mathbb{Q}(\\sqrt{-3})$";

  try {
    const simpleResult = await simpleResearch.generate(prompt); // generate runs the research pipeline

    console.log("simpleResult", simpleResult.data.text);
    console.log("simpleBibliography", simpleResult.data.bibliography);
  } catch (error) {
    console.error("Research failed with error:", error);
    process.exit(1);
  }
}

// Run the research
simpleResearch();

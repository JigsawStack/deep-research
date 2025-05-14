import createDeepResearch, { DeepResearch } from '../..';
import { createGoogleGenerativeAI } from '@ai-sdk/google';

const geminiInstance = createGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY
})

// Basic usage example
async function basicResearch() {
  const deepResearch = new DeepResearch({
    depth: {
      level: 3, // Detailed analysis
      includeReferences: true,
    },
    breadth: {
      level: 2, // Main topic + direct relationships
      maxParallelTopics: 4,
    },
    synthesis: {
      maxOutputTokens: 8000, // Hard upper limit of tokens
      targetOutputLength: 5000,
      formatAsMarkdown: true,
    },
    models : {
      output: geminiInstance

    }
    format: 'json',
  });

  const result = deepResearch.generate()

  // Log research results
  console.log('\n=== RESEARCH SUMMARY ===');
  console.log(`Research completed successfully: ${result.success}`);
  console.log('\n=== RESEARCH ===');
  console.log(result.research);

  // Log token usage
  console.log('\n=== TOKEN USAGE ===');
  console.log(result._usage);

  // Log sources
  console.log('\n=== SOURCES ===');
  console.log(result.sources);

  return result;
}

basicResearch().catch(console.error);

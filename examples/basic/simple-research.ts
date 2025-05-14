import createDeepResearch from '../..';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { createDeepInfra } from '@ai-sdk/deepinfra';

const geminiInstance = createGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY,
});
const openaiInstance = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});
const deepInfraInstance = createDeepInfra({
  apiKey: process.env.DEEPINFRA_API_KEY,
});

// Basic usage example
async function basicResearch() {
  // Create instance using the factory function
  const deepResearch = await createDeepResearch({
    depth: {
      level: 3, // Detailed analysis
      includeReferences: true,
      confidenceThreshold: 0.7,
    },
    breadth: {
      level: 2, // Main topic + direct relationships
      maxParallelTopics: 4,
      includeRelatedTopics: true,
      minRelevanceScore: 0.8,
    },
    synthesis: {
      maxOutputTokens: 8000, // Hard upper limit of tokens
      targetOutputLength: 'detailed', // Changed to use the correct type
      formatAsMarkdown: true,
    },
    models: {
      // Use the correct model types as defined in the config
      default: openaiInstance, // For regular generations
      reasoning: deepInfraInstance, // For synthesis and analysis
      output: geminiInstance, // For quick operations
    },
    format: 'json',
  });

  // Need to provide prompts array as required by generate method
  const prompts = [
    'What are the latest developments in quantum computing?',
    // Add more related prompts if needed
  ];

  const result = await deepResearch.generate(prompts); // Make sure to await the promise

  // Log research results
  console.log('\n=== RESEARCH SUMMARY ===');
  console.log(`Research completed successfully: ${result.success}`);

  console.log('\n=== RESEARCH ===');
  console.log(result.research);

  // Log token usage
  console.log('\n=== TOKEN USAGE ===');
  console.log({
    inputTokens: result._usage.input_tokens,
    outputTokens: result._usage.output_tokens,
    inferenceTimeTokens: result._usage.inference_time_tokens,
    totalTokens: result._usage.total_tokens,
  });

  // Log sources (currently empty array, but will be populated in future)
  console.log('\n=== SOURCES ===');
  console.log(result.sources);

  return result;
}

// Make sure to handle errors properly
basicResearch().catch((error) => {
  console.error('Research failed:', error);
  process.exit(1);
});

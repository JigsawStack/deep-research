import createDeepResearch from '../..';
import 'dotenv/config';
import { createOpenAI } from '@ai-sdk/openai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createDeepInfra } from '@ai-sdk/deepinfra';

// Basic usage example
async function basicResearch() {
  // Create model instances directly
  const openai = createOpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  const gemini = createGoogleGenerativeAI({
    apiKey: process.env.GEMINI_API_KEY,
  });

  const deepinfra = createDeepInfra({
    apiKey: process.env.DEEPINFRA_API_KEY,
  });

  // Get model instances
  const openaiModel = openai.languageModel('gpt-4o');
  const geminiModel = gemini.languageModel('gemini-2.0-flash');
  const deepseekModel = deepinfra.languageModel('deepseek-ai/DeepSeek-R1');

  // Create instance using the factory function with direct model instances
  const deepResearch = createDeepResearch({
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
      targetOutputLength: 5000,
      formatAsMarkdown: true,
    },
    models: {
      default: openaiModel, // Pass the model instance directly
      reasoning: deepseekModel, // Pass the model instance directly
      output: geminiModel, // Pass the model instance directly
    },
    jigsawApiKey: process.env.JIGSAW_API_KEY,
  });

  // Need to provide prompts array as required by generate method
  const prompts = ['what is the meaning of life?'];

  try {
    console.log('Starting deep research...');
    const result = await deepResearch.generate(prompts);

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
  } catch (error) {
    console.error('Research failed with error:', error);
    process.exit(1);
  }
}

// Run the research
basicResearch();

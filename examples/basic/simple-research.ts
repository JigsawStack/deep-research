import createDeepResearch from '../..';
import 'dotenv/config';
import { createOpenAI } from '@ai-sdk/openai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createDeepInfra } from '@ai-sdk/deepinfra';

// Basic usage example
async function basicResearch() {
  // Check for required API keys
  if (
    !process.env.OPENAI_API_KEY ||
    !process.env.GEMINI_API_KEY ||
    !process.env.DEEPINFRA_API_KEY
  ) {
    console.error('Error: API keys are required for all models.');
    console.error(
      'Please set OPENAI_API_KEY, GEMINI_API_KEY, and DEEPINFRA_API_KEY in your environment variables.'
    );
    process.exit(1);
  }

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

  // Create instance using the factory function with default model assignments
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
      default: openaiModel, // OpenAI as default model
      reasoning: deepseekModel, // DeepInfra for reasoning
      output: geminiModel, // Gemini for output formatting
    },
    // Pass API keys from environment variables to config
    openaiApiKey: process.env.OPENAI_API_KEY,
    geminiApiKey: process.env.GEMINI_API_KEY,
    deepInfraApiKey: process.env.DEEPINFRA_API_KEY,
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

    return result;
  } catch (error) {
    console.error('Research failed with error:', error);
    process.exit(1);
  }
}

// Run the research
basicResearch();

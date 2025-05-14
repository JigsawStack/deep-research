import createDeepResearch from '../..';
import 'dotenv/config';

// Basic usage example
async function basicResearch() {
  // Create instance using the factory function
  const deepResearch = await createDeepResearch({
    depth: {
      level: 2, // Detailed analysis
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
      targetOutputLength: 'detailed',
      formatAsMarkdown: true,
    },
    models: {
      default: 'gpt-4o', // Default model
      reasoning: 'gpt-4o', // Reasoning model
      output: 'gpt-4o', // Output model - using the same model for consistency
    },
    jigsawApiKey: process.env.JIGSAW_API_KEY,
  });

  // Need to provide prompts array as required by generate method
  const prompts = [
    'What are the latest developments in quantum computing?',
    // Add more related prompts if needed
  ];

  try {
    console.log('Starting deep research...');
    const result = await deepResearch.generate(prompts, 'markdown');

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

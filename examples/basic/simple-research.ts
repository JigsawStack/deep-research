import createDeepResearch from '../..';

// Basic usage example
async function basicResearch() {
  const result = await createDeepResearch({
    prompt: [
      'Could you tell me what the best area to live in SF?',
    ],
    // Using mostly default settings with slight modifications
    depth: {
      level: 2, // Detailed analysis
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
    format: 'json',
  });

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

import createDeepResearch from '../..';

// Basic usage example
async function basicResearch() {
  console.log('Starting basic research with debug logging...');
  const research = await createDeepResearch({
    prompt: [
      'Could you write a research paper on AI impacts on food with consumer side?',
    ],
    // Using mostly default settings with slight modifications
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
  });
}

basicResearch().catch(console.error);

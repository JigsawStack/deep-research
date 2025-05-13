import createDeepResearch from '../..';

// Basic usage example
async function basicResearch() {
  const research = await createDeepResearch({
    prompt: ['Could you write a research paper on AI impacts on food with consumer side?'],
    // Using mostly default settings with slight modifications
    depth: {
      level: 3, // Detailed analysis
      includeReferences: true,
    },
    breadth: {
      level: 2, // Main topic + direct relationships
      maxParallelTopics: 4,
    },
  });
}

basicResearch().catch(console.error);

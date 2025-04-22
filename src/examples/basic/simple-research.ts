import createDeepResearch from '../..';

// Basic usage example
async function basicResearch() {
  const research = await createDeepResearch({
    prompt: ['What is the impact of AI on healthcare?'],
    // Using mostly default settings with slight modifications
    depth: {
      level: 2,  // Detailed analysis
      includeReferences: true
    },
    breadth: {
      level: 2,  // Main topic + direct relationships
      maxParallelTopics: 4
    }
  });
}

basicResearch().catch(console.error); 
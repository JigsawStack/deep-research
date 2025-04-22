import createDeepResearch from '../..';

// Basic usage example
async function basicResearch() {
  const research = await createDeepResearch({
    prompt: ['Is michael jordan a good basketball player?'],
    // Using mostly default settings with slight modifications
    depth: {
      level: 2,  // Detailed analysis
      includeReferences: true
    },
    breadth: {
      level: 2,  // Main topic + direct relationships
      maxParallelTopics: 2
    }
  });
}

basicResearch().catch(console.error); 
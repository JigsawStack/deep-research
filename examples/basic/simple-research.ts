import createDeepResearch from '../..';

// Basic usage example
async function basicResearch() {
  const result = await createDeepResearch({
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

  // Log research results
  console.log('\n=== RESEARCH SUMMARY ===');
  console.log(`Research completed successfully: ${result.success}`);

  // Log summary points
  console.log('\n=== SUMMARY POINTS ===');
  console.log('- ' + result.summary.join('\n- '));

  // Log token usage
  console.log('\n=== TOKEN USAGE ===');
  console.log(result._usage);

  // Still access the full synthesis if needed
  if (result.finalSynthesis) {
    console.log('\n=== FINAL RESEARCH SYNTHESIS ===');
    console.log(result.finalSynthesis.analysis);
    console.log('\n=== KEY THEMES ===');
    console.log('- ' + result.finalSynthesis.keyThemes.join('\n- '));
    console.log('\n=== INSIGHTS ===');
    console.log('- ' + result.finalSynthesis.insights.join('\n- '));
    console.log('\n=== CONFIDENCE ===');
    console.log(result.finalSynthesis.confidence);
  }

  return result;
}

basicResearch().catch(console.error);

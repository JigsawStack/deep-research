import createDeepResearch from '../..';

// Advanced usage example with different research approaches
async function advancedResearch() {
  // Academic Research Configuration
  const academicResearch = createDeepResearch({
    prompt: ['What are the latest developments in fusion energy research?'],
    depth: {
      level: 5,  // Academic-level analysis
      maxTokensPerAnalysis: 4096,  // Detailed responses
      includeReferences: true,
      confidenceThreshold: 0.95  // Very high confidence required
    },
    breadth: {
      level: 4,  // Comprehensive coverage
      maxParallelTopics: 5,
      includeRelatedTopics: true,
      minRelevanceScore: 0.8  // High relevance required
    }
  });

  // Quick Market Research Configuration
  const marketResearch = createDeepResearch({
    prompt: ['Current trends in electric vehicle market'],
    depth: {
      level: 2,  // Detailed but not too deep
      maxTokensPerAnalysis: 1024,  // Shorter responses
      includeReferences: false,  // Skip references for speed
      confidenceThreshold: 0.7  // Allow more speculative insights
    },
    breadth: {
      level: 3,  // Extended exploration
      maxParallelTopics: 4,
      includeRelatedTopics: true,
      minRelevanceScore: 0.6  // Include broader market trends
    }
  });

  // Focused Technical Analysis
  const technicalAnalysis = createDeepResearch({
    prompt: ['Specific improvements in battery technology for EVs'],
    depth: {
      level: 4,  // Expert-level deep dive
      maxTokensPerAnalysis: 2048,
      includeReferences: true,
      confidenceThreshold: 0.85
    },
    breadth: {
      level: 1,  // Single focus
      maxParallelTopics: 2,
      includeRelatedTopics: false,  // Stay focused on core topic
      minRelevanceScore: 0.9  // Only highly relevant information
    }
  });

}

advancedResearch().catch(console.error); 
# Deep Research Implementation Guide

This document provides technical details for implementing the recursive search mechanism required for the Deep Research library.

## Architecture Overview

The deep research system implements a recursive search pattern that explores topics in both breadth and depth:

```
Main Question → Sub-Questions → Web Search → Analyze → More Sub-Questions → ...
```

## Key Components

### 1. Recursive Search Manager

The core component needed for implementation is a `RecursiveSearchManager` that will:

- Track the current search depth
- Maintain the context chain between search levels
- Decide when to stop recursion
- Aggregate results from different search paths

```typescript
interface RecursiveSearchContext {
  mainQuestion: string;
  parentQuestion?: string;
  currentDepth: number;
  searchPath: string[];
  previousResults: SearchResult[];
  exploredQuestions: Set<string>;
}

class RecursiveSearchManager {
  private config: DeepResearchConfig;
  private searchProvider: JigsawProvider;
  private questionGenerator: SubQuestionGenerator;
  private synthesizer: ResultSynthesizer;

  constructor(config: DeepResearchConfig) {...}

  // Main recursive search method
  async executeRecursiveSearch(question: string, context?: RecursiveSearchContext): Promise<DeepResearchResult>;

  // Helper methods
  private shouldContinueRecursion(context: RecursiveSearchContext): boolean;
  private updateContext(parentContext: RecursiveSearchContext, newQuestion: string): RecursiveSearchContext;
  private aggregateResults(results: DeepResearchResult[]): DeepResearchResult;
}
```

### 2. Context-Aware Question Generator

Enhance the existing `SubQuestionGenerator` to be aware of search context:

```typescript
interface EnhancedQuestionGeneratorOptions {
  context?: RecursiveSearchContext;
  maxQuestions?: number;
  relevanceThreshold?: number;
}

// Enhanced generator that builds on existing implementation
class EnhancedQuestionGenerator extends SubQuestionGenerator {
  async generateContextAwareQuestions(
    mainPrompt: string[],
    options: EnhancedQuestionGeneratorOptions
  ): Promise<SubQuestionGeneratorResult> {
    // 1. Generate candidate questions
    // 2. Filter based on previously explored questions
    // 3. Ensure relevance to main question
    // 4. Prioritize questions that build on known information
  }
}
```

### 3. Result Synthesizer

Create a new component to synthesize results from multiple search paths:

```typescript
class ResultSynthesizer {
  async synthesize(
    mainQuestion: string,
    searchResults: WebSearchResult[],
    recursiveResults: DeepResearchResult[]
  ): Promise<DeepResearchResult> {
    // 1. Extract key information from all sources
    // 2. Resolve contradictions
    // 3. Structure information by relevance
    // 4. Generate comprehensive answer with citations
  }
}
```

## Recursive Search Algorithm

Here's the core recursive search algorithm:

```typescript
async function recursiveSearch(question, context, depth = 0, maxDepth = 3) {
  // Base case: reached maximum depth
  if (depth >= maxDepth) {
    return searchAndAnalyze(question);
  }

  // 1. Generate sub-questions based on the current question
  const subQuestions = generateSubQuestions(question, context);

  // 2. Execute searches for each sub-question
  const searchResults = await Promise.all(
    subQuestions.map((sq) => searchAndAnalyze(sq.question))
  );

  // 3. For each promising result, generate deeper sub-questions
  const recursiveResults = await Promise.all(
    searchResults
      .filter((result) => isPromisingForDeepening(result))
      .map((result) => {
        const newQuestion = generateFollowUpQuestion(result);
        const newContext = updateContext(context, result);
        return recursiveSearch(newQuestion, newContext, depth + 1, maxDepth);
      })
  );

  // 4. Combine all results
  return synthesizeResults(question, searchResults, recursiveResults);
}
```

## Implementation Steps

### Phase 1: Basic Recursive Framework

1. Create the `RecursiveSearchManager` class
2. Implement depth tracking and context maintenance
3. Integrate with existing search functionality
4. Add simple result aggregation

### Phase 2: Enhanced Question Generation

1. Update `SubQuestionGenerator` to be context-aware
2. Implement relevance filtering based on the main question
3. Add duplicate question detection
4. Implement question priority based on information gaps

### Phase 3: Result Synthesis and Citations

1. Create the `ResultSynthesizer` class
2. Implement source tracking for all information
3. Add citation generation
4. Create a system for resolving conflicting information

### Phase 4: Optimization and Refinement

1. Implement parallel processing for searches
2. Add caching for search results
3. Optimize LLM prompt strategies
4. Add detailed logging and telemetry

## Configuration Options

The recursive search system should support these configuration options:

```typescript
interface RecursiveSearchConfig {
  maxDepth: number; // Maximum recursion depth
  maxBreadthPerLevel: number; // Maximum sub-questions per level
  relevanceThreshold: number; // Minimum relevance score (0-1)
  minConfidenceForRecursion: number; // Confidence threshold to continue recursion
  includeSourceMetadata: boolean; // Include source URLs, titles, etc.
  deduplicationStrategy: 'exact' | 'semantic' | 'none'; // How to detect duplicates
  contextRetentionStrategy: 'full' | 'summary' | 'key-points'; // How to pass context
}
```

## Expected Results Structure

The final deep research result should have this structure:

```typescript
interface DeepResearchResult {
  answer: string;
  confidence: number;
  sources: {
    url: string;
    title: string;
    relevance: number;
    extractedInfo: string[];
  }[];
  citations: {
    id: string;
    text: string;
    sourceIndex: number;
  }[];
  searchPath: {
    question: string;
    depth: number;
    parent?: string;
  }[];
}
```

## Integration with Existing Code

The recursive search functionality should be integrated with the existing codebase as follows:

1. Extend the `DeepResearch` class in `src/index.ts` to support recursive search
2. Add new configuration options to `DeepResearchConfig`
3. Create new types in `src/types/index.ts` for the recursive search components
4. Build on the existing JigsawProvider for web searches

## Performance Considerations

- Implement request throttling to avoid rate limits
- Add result caching to avoid duplicate searches
- Consider using a more efficient data structure for tracking explored questions
- Implement parallel processing where possible

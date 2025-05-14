import { AIProvider } from '../provider/aiProvider';
import {
  ReportInput,
  ReportConfig,
  SynthesisInput,
  SynthesisOutput,
} from '../types/synthesis';
import { WebSearchResult } from '../types';
import { cleanJsonResponse } from '../utils/utils';
import 'dotenv/config';
import {
  generateSynthesisPrompt,
  generateReportPrompt,
  generateEvaluationPrompt,
} from '../prompts/synthesis';

/**
 * Synthesize search results into a coherent analysis
 */
export async function synthesize(
  input: SynthesisInput,
  provider: AIProvider
): Promise<SynthesisOutput> {
  const { mainPrompt, results, currentDepth, parentSynthesis } = input;

  const { systemPrompt, userPrompt } = generateSynthesisPrompt({
    mainPrompt,
    results,
    currentDepth,
    parentSynthesis,
  });

  try {
    const combinedPrompt = `${systemPrompt}\n\n${userPrompt}`;
    const response = await provider.generateText(
      combinedPrompt,
      provider.getDefaultModel()
    );

    let synthesis: SynthesisOutput;
    try {
      const cleanedResponse = cleanJsonResponse(response);
      console.log(`Synthesis at depth ${currentDepth} completed`);

      synthesis = JSON.parse(cleanedResponse);
      synthesis.depth = currentDepth;
    } catch (parseError) {
      console.error('Raw synthesis response:', response);
      throw new Error(
        `Failed to parse synthesis response as JSON: ${parseError}`
      );
    }

    return synthesis;
  } catch (error) {
    console.error('Error generating synthesis:', error);
    return failedSynthesis(mainPrompt, results, currentDepth);
  }
}

/**
 * Generate a default synthesis when the AI synthesis fails
 */
export function failedSynthesis(
  mainPrompt: string[],
  results: WebSearchResult[],
  currentDepth: number
): SynthesisOutput {
  return {
    analysis: `Synthesis of ${
      results.length
    } results related to ${mainPrompt.join(', ')}`,
    keyThemes: ['Information insufficient for detailed synthesis'],
    insights: ['Unable to generate insights due to processing error'],
    knowledgeGaps: ['Complete synthesis unavailable - further research needed'],
    confidence: 0.3,
    depth: currentDepth,
    relatedQuestions: results.map((r) => r.question.question),
  };
}

/**
 * Generate a comprehensive research report from all syntheses
 */
export async function generateReport(
  input: ReportInput,
  config: ReportConfig,
  provider: AIProvider
): Promise<SynthesisOutput> {
  const { mainPrompt, allSyntheses } = input;
  const { maxOutputTokens, targetOutputLength } = config;

  const { systemPrompt, userPrompt } = generateReportPrompt({
    mainPrompt,
    allSyntheses,
    maxOutputTokens,
    targetOutputLength,
  });

  try {
    const combinedPrompt = `${systemPrompt}\n\n${userPrompt}`;
    const response = await provider.generateText(
      combinedPrompt,
      provider.getOutputModel()
    );

    let report: SynthesisOutput;
    try {
      const cleanedResponse = cleanJsonResponse(response);
      console.log('Research report generated');

      report = JSON.parse(cleanedResponse);
      report.depth = 0; // 0 represents final report
    } catch (parseError) {
      console.error('Error generating research report:', parseError);
      throw new Error(`Failed to parse research report as JSON: ${parseError}`);
    }

    return report;
  } catch (error) {
    console.error('Error generating research report:', error);
    return failedSynthesis(mainPrompt, [], 0);
  }
}

/**
 * Check if we have sufficient information to stop the research
 * Uses the reasoning model to evaluate if the current information is enough
 * to generate a comprehensive research report
 */
export async function hasSufficientInformation(
  input: SynthesisInput,
  confidenceThreshold: number = 0.85,
  provider?: AIProvider
): Promise<boolean> {
  if (!provider) {
    // If no provider is passed, fall back to the simple heuristic approach
    // If we have a parent synthesis with high confidence, we might have enough info
    if (
      input.parentSynthesis &&
      input.parentSynthesis.confidence >= confidenceThreshold
    ) {
      // Check if we have a good variety of themes and insights
      const hasSubstantiveContent =
        input.parentSynthesis.keyThemes &&
        input.parentSynthesis.keyThemes.length >= 3 &&
        input.parentSynthesis.insights &&
        input.parentSynthesis.insights.length >= 3 &&
        input.parentSynthesis.knowledgeGaps &&
        input.parentSynthesis.knowledgeGaps.length <= 2; // Not too many knowledge gaps

      if (hasSubstantiveContent) {
        return true;
      }
    }

    // If we have many results at the current depth, we might have enough info
    if (input.results.length >= 5) {
      return true;
    }

    return false;
  }

  // Use the reasoning model to evaluate if we have sufficient information
  const { mainPrompt, results, currentDepth, parentSynthesis } = input;

  const { systemPrompt, userPrompt } = generateEvaluationPrompt({
    mainPrompt,
    results,
    currentDepth,
    parentSynthesis,
  });

  try {
    const combinedPrompt = `${systemPrompt}\n\n${userPrompt}`;
    const response = await provider.generateText(
      combinedPrompt,
      provider.getReasoningModel()
    );

    try {
      const cleanedResponse = cleanJsonResponse(response);
      const evaluation = JSON.parse(cleanedResponse);

      console.log(`Information sufficiency evaluation:`, {
        confidenceScore: evaluation.confidenceScore,
        sufficientInformation: evaluation.sufficientInformation,
        potentialQuestions: evaluation.potentialQuestions?.length || 0,
      });

      // Return the model's evaluation, or fall back to the confidence threshold
      return typeof evaluation.sufficientInformation === 'boolean'
        ? evaluation.sufficientInformation
        : evaluation.confidenceScore >= confidenceThreshold;
    } catch (parseError) {
      console.error('Error parsing evaluation response:', parseError);
      // Fall back to simple heuristic
      return input.results.length >= 5;
    }
  } catch (error) {
    console.error('Error evaluating information sufficiency:', error);
    // Fall back to simple heuristic
    return input.results.length >= 5;
  }
}

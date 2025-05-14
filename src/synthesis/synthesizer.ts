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
} from '../prompts/synthesis';

/**
 * Synthesize search results into a coherent analysis
 */
export async function synthesize(
  input: SynthesisInput,
  provider: AIProvider,
  model: string = 'gemini-2.0-flash'
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
    const response = await provider.generateText(combinedPrompt, model);

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
  provider: AIProvider,
  model: string = 'gemini-2.0-flash'
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
    const response = await provider.generateText(combinedPrompt, model);

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
 * Does this content sufficient for the main questions asked
 * Out of 5?
 * Do you think that there can be more relevant questions that can be asked
 * Should I go deeper or should
 */

export async function hasSufficientInformation(
  input: SynthesisInput,
  confidenceThreshold: number = 0.85
): Promise<boolean> {
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

import { AIProvider } from '../provider/aiProvider';
import {
  ReportInput,
  ReportConfig,
  SynthesisInput,
  SynthesisOutput,
  ReportOutput,
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
    console.log(
      `Beginning synthesis at depth ${currentDepth} with ${results.length} results...`
    );
    const combinedPrompt = `${systemPrompt}\n\n${userPrompt}`;

    // Use reasoning model for synthesis to get better analytical results
    console.log(`Using reasoning model for depth ${currentDepth} synthesis...`);
    const response = await provider.generateText(
      combinedPrompt,
      provider.getReasoningModel()
    );

    let synthesis: SynthesisOutput;
    try {
      const cleanedResponse = cleanJsonResponse(response);
      console.log(
        `Synthesis at depth ${currentDepth} completed, processing JSON output...`
      );

      synthesis = JSON.parse(cleanedResponse);
      synthesis.depth = currentDepth;

      // Add diagnostics
      console.log(
        `Synthesis at depth ${currentDepth} successfully parsed with:`
      );
      console.log(
        `- Analysis length: ${
          synthesis.analysis ? synthesis.analysis.length : 0
        } chars`
      );
      console.log(`- Key themes: ${synthesis.keyThemes.length} items`);
      console.log(`- Insights: ${synthesis.insights.length} items`);
      console.log(`- Knowledge gaps: ${synthesis.knowledgeGaps.length} items`);
      console.log(`- Confidence: ${synthesis.confidence}`);
    } catch (parseError) {
      console.error('Raw synthesis response:', response);
      console.error('JSON parse error details:', parseError);
      throw new Error(
        `Failed to parse synthesis response as JSON: ${parseError}`
      );
    }

    return synthesis;
  } catch (error) {
    console.error(
      `Error generating synthesis at depth ${currentDepth}:`,
      error
    );
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
 * Generate a default report when the AI report generation fails
 */
export function failedReport(
  mainPrompt: string[],
  sources: Array<{
    url: string;
    title: string;
    domain: string;
  }> = []
): ReportOutput {
  return {
    analysis: `Research report for ${mainPrompt.join(
      ', '
    )} could not be generated.`,
    keyThemes: ['Report generation failed'],
    insights: ['Unable to generate report due to processing error'],
    knowledgeGaps: ['Complete report unavailable - please try again'],
    sources: sources.map((source, index) => ({
      index: index + 1,
      url: source.url,
      title: source.title || 'Unknown Title',
      domain: source.domain || new URL(source.url).hostname,
    })),
  };
}

/**
 * Generate a comprehensive research report from all syntheses
 */
export async function generateReport(
  input: ReportInput,
  config: ReportConfig,
  provider: AIProvider,
  sources: Array<{
    url: string;
    title: string;
    domain: string;
    ai_overview: string;
    isAcademic?: boolean;
  }> = []
): Promise<ReportOutput> {
  const { mainPrompt, allSyntheses } = input;
  const { maxOutputTokens, targetOutputLength } = config;

  const { systemPrompt, userPrompt } = generateReportPrompt({
    mainPrompt,
    allSyntheses,
    maxOutputTokens,
    targetOutputLength,
    sources,
  });

  try {
    const combinedPrompt = `${systemPrompt}\n\n${userPrompt}`;
    const response = await provider.generateText(
      combinedPrompt,
      provider.getOutputModel()
    );

    let report: ReportOutput;
    try {
      // Clean the response
      const cleanedResponse = cleanJsonResponse(response);
      console.log('Research report generated');

      // Simply use the response as the analysis without complex extraction
      report = {
        analysis: cleanedResponse,
        keyThemes: ['Research report'],
        insights: ['See full analysis for details'],
        knowledgeGaps: ['See full analysis for details'],
        sources: [],
      };

      // Add source references to the report
      if (sources.length > 0) {
        report.sources = sources.map((source, index) => ({
          index: index + 1,
          url: source.url,
          title: source.title || 'Unknown Title',
          domain: source.domain || new URL(source.url).hostname,
        }));
      }
    } catch (error) {
      console.error('Error processing research report:', error);

      // Fallback to treating the entire response as the analysis
      report = {
        analysis: response,
        keyThemes: ['Research report'],
        insights: ['See full analysis for details'],
        knowledgeGaps: ['See full analysis for details'],
        sources: [],
      };

      // Still add sources even in error case
      if (sources.length > 0) {
        report.sources = sources.map((source, index) => ({
          index: index + 1,
          url: source.url,
          title: source.title || 'Unknown Title',
          domain: source.domain || new URL(source.url).hostname,
        }));
      }
    }

    return report;
  } catch (error) {
    console.error('Error generating research report:', error);
    return failedReport(
      mainPrompt,
      sources.map((s) => ({
        url: s.url,
        title: s.title || 'Unknown Title',
        domain: s.domain || new URL(s.url).hostname,
      }))
    );
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
    // Use reasoning model for evaluation to leverage its logical capabilities
    const reasoningOutput = await provider.generateText(
      combinedPrompt,
      provider.getReasoningModel()
    );

    // Process the output to extract the conclusion
    if (reasoningOutput.toLowerCase().includes('sufficient: true')) {
      return true;
    } else if (reasoningOutput.toLowerCase().includes('sufficient: false')) {
      return false;
    }

    // If we can't determine from the format, check for confidence level
    const confidenceMatch = reasoningOutput.match(/confidence:\s*([0-9.]+)/i);
    if (confidenceMatch && confidenceMatch[1]) {
      const confidence = parseFloat(confidenceMatch[1]);
      return confidence >= confidenceThreshold;
    }

    // Default behavior based on the presence of keywords
    return (
      reasoningOutput.toLowerCase().includes('sufficient') &&
      !reasoningOutput.toLowerCase().includes('insufficient') &&
      !reasoningOutput.toLowerCase().includes('not sufficient')
    );
  } catch (error) {
    console.error('Error evaluating information sufficiency:', error);
    // Default to false when evaluation fails
    return false;
  }
}

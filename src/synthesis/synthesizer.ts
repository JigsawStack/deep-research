import GeminiProvider from '../provider/gemini';
import {
  FinalSynthesisInput,
  SynthesisInput,
  SynthesisOutput,
} from '../types/synthesis';
import { WebSearchResult } from '../types';
import { cleanJsonResponse } from '../utils/utils';
import 'dotenv/config';
import {
  generateSynthesisPrompt,
  generateFinalSynthesisPrompt,
} from '../prompts/synthesis';

export class Synthesizer {
  private geminiInstance: GeminiProvider;

  constructor() {
    this.geminiInstance = GeminiProvider.getInstance({
      apiKey: process.env.GEMINI_API_KEY || '',
    });
  }

  async synthesizeResults(input: SynthesisInput): Promise<SynthesisOutput> {
    const { mainPrompt, results, currentDepth, parentSynthesis } = input;

    const { systemPrompt, userPrompt } = generateSynthesisPrompt({
      mainPrompt,
      results,
      currentDepth,
      parentSynthesis,
    });

    try {
      const combinedPrompt = `${systemPrompt}\n\n${userPrompt}`;
      const response = await this.geminiInstance.generateText(
        combinedPrompt,
        'gemini-2.0-flash'
      );

      let synthesis: SynthesisOutput;
      try {
        // Clean the response to handle markdown-formatted JSON
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
      return this.generateDefaultSynthesis(mainPrompt, results, currentDepth);
    }
  }

  private generateDefaultSynthesis(
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
      knowledgeGaps: [
        'Complete synthesis unavailable - further research needed',
      ],
      confidence: 0.3,
      depth: currentDepth,
      relatedQuestions: results.map((r) => r.question.question),
    };
  }

  async generateFinalSynthesis(
    input: FinalSynthesisInput
  ): Promise<SynthesisOutput> {
    const {
      mainPrompt,
      allSyntheses = [],
      maxOutputTokens,
      targetOutputLength,
    } = input;

    const { systemPrompt, userPrompt } = generateFinalSynthesisPrompt({
      mainPrompt,
      allSyntheses,
      maxOutputTokens,
      targetOutputLength,
    });

    try {
      const combinedPrompt = `${systemPrompt}\n\n${userPrompt}`;
      const response = await this.geminiInstance.generateText(
        combinedPrompt,
        'gemini-2.0-flash'
      );

      console.log(`Raw synthesis response: ${response.substring(0, 200)}...`);

      let synthesis: SynthesisOutput;
      try {
        // Clean the response to handle markdown-formatted JSON
        const cleanedResponse = cleanJsonResponse(response);
        console.log(`Final synthesis completed`);

        synthesis = JSON.parse(cleanedResponse);

        // If we're getting a JSON metadata object without an analysis field,
        // use the full markdown article as the analysis
        if (!synthesis.analysis && response.length > 0) {
          synthesis.analysis = response;
        }

        synthesis.depth = 0; // 0 represents final synthesis
      } catch (parseError) {
        console.error('Error generating final synthesis:', parseError);
        throw new Error(
          `Failed to parse final synthesis response as JSON: ${parseError}`
        );
      }

      return synthesis;
    } catch (error) {
      console.error('Error generating final synthesis:', error);
      return this.generateDefaultSynthesis(mainPrompt, [], 0);
    }
  }

  async hasSufficientInformation(
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
}

export default Synthesizer;

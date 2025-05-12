import GeminiProvider from '../provider/gemini';
import { SynthesisInput, SynthesisOutput } from '../types/synthesis';
import { WebSearchResult } from '../types';
import { cleanJsonResponse } from '../utils';
import 'dotenv/config';

export class Synthesizer {
  private geminiInstance: GeminiProvider;

  constructor() {
    this.geminiInstance = GeminiProvider.getInstance({
      apiKey: process.env.GEMINI_API_KEY || '',
    });
  }

  async synthesizeResults(input: SynthesisInput): Promise<SynthesisOutput> {
    const { mainPrompt, results, currentDepth, parentSynthesis } = input;

    // Combine all search results for this level
    const combinedContent = results
      .map((result) => {
        return `
Question: ${result.question.question}
Overview: ${result.searchResults.ai_overview}
      `;
      })
      .join('\n\n');

    const systemPrompt = `You are an expert research synthesizer. Your task is to analyze and synthesize information from multiple search results related to a main research topic.

Based on the search results provided, you will:
1. Create a comprehensive summary that integrates all important findings
2. Identify key themes and patterns across the results
3. Generate insights that aren't explicitly stated in any single result
4. Identify any contradictions between sources and attempt to resolve them
5. Highlight knowledge gaps that still need to be addressed
6. Provide a confidence score (0-1) for the overall synthesis

Format your response as a valid JSON object with the following structure:
{
  "summary": "A comprehensive summary integrating all findings...",
  "keyThemes": ["Theme 1", "Theme 2", ...],
  "insights": ["Insight 1", "Insight 2", ...],
  "knowledgeGaps": ["Gap 1", "Gap 2", ...],
  "conflictingInformation": [
    {
      "topic": "Topic with conflict",
      "conflicts": [
        {
          "claim1": "First claim",
          "claim2": "Contradicting claim",
          "resolution": "Possible resolution if available"
        }
      ]
    }
  ],
  "confidence": 0.85,
  "relatedQuestions": ["Question 1", "Question 2", ...]
}`;

    const userPrompt = `Main Research Topic(s):
${mainPrompt.join('\n')}

Current Depth Level: ${currentDepth}

${parentSynthesis ? `Parent Synthesis Summary: ${parentSynthesis.summary}` : ''}

Search Results:
${combinedContent}

Please synthesize this information according to the instructions.`;

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
      summary: `Synthesis of ${
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
}

export default Synthesizer;

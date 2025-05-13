import GeminiProvider from '../provider/gemini';
import {
  FinalSynthesisInput,
  SynthesisInput,
  SynthesisOutput,
} from '../types/synthesis';
import { WebSearchResult } from '../types';
import { cleanJsonResponse } from '../utils/utils';
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
1. Create a comprehensive research analysis that integrates all important findings
2. Identify key themes and patterns across the results
3. Generate insights that aren't explicitly stated in any single result
4. Identify any contradictions between sources and attempt to resolve them
5. Highlight knowledge gaps that still need to be addressed
6. Provide a confidence score (0-1) for the overall synthesis

Format your response as a valid JSON object with the following structure:
{
  "analysis": "A comprehensive analysis integrating all findings...",
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

${
  parentSynthesis
    ? `Parent Synthesis Analysis: ${parentSynthesis.analysis}`
    : ''
}

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

    // Log the targetOutputLength
    console.log(
      `Synthesizer received targetOutputLength: ${targetOutputLength}`
    );

    // Convert targetLength to specific instructions
    let lengthGuidance = '';
    if (targetOutputLength) {
      if (typeof targetOutputLength === 'number') {
        console.log(`Setting length guidance for ${targetOutputLength} tokens`);
        lengthGuidance = `CRITICAL REQUIREMENT: Your response MUST be at least ${targetOutputLength} tokens long. This is not a suggestion but a strict requirement. Please provide extensive detail, examples, analysis, and elaboration on all aspects of the topic to reach this minimum length. Do not summarize or be concise.`;
      } else {
        console.log(`Setting length guidance for ${targetOutputLength} mode`);
        switch (targetOutputLength) {
          case 'concise':
            lengthGuidance =
              'Please be very concise, focusing only on the most essential information.';
            break;
          case 'standard':
            lengthGuidance =
              'Please provide a balanced synthesis with moderate detail.';
            break;
          case 'detailed':
            lengthGuidance =
              'Please provide a comprehensive analysis with substantial detail.';
            break;
        }
      }
    }

    // Combine all syntheses
    const combinedSyntheses = allSyntheses
      .map((synthesis) => {
        return `
Depth: ${synthesis.depth}
Analysis: ${synthesis.analysis}
Key Themes: ${synthesis.keyThemes.join(', ')}
Insights: ${synthesis.insights.join(', ')}
Knowledge Gaps: ${synthesis.knowledgeGaps.join(', ')}
Confidence: ${synthesis.confidence}
        `;
      })
      .join('\n\n');

    const systemPrompt = `You are an expert research synthesizer. Your task is to create a final comprehensive synthesis from multiple research findings related to a main research topic.

Based on the intermediate syntheses provided, you will:
1. Create a comprehensive final research analysis that integrates all important findings
2. Identify key overarching themes and patterns across all research
3. Generate high-level insights that weren't explicitly stated in any intermediate synthesis
4. Identify the most significant knowledge gaps that still need to be addressed
5. Highlight the most important conflicting information across sources and provide resolutions where possible
6. Provide a confidence score (0-1) for the overall synthesis

Format your response as a valid JSON object with the following structure:
{
  "analysis": "A comprehensive analysis integrating all findings...",
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

${lengthGuidance}

${
  maxOutputTokens
    ? `Your response must not exceed ${maxOutputTokens} tokens.`
    : ''
}

Intermediate Research Syntheses:
${combinedSyntheses}

Please create a final comprehensive synthesis according to the instructions.`;

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
        console.log(`Final synthesis completed`);

        synthesis = JSON.parse(cleanedResponse);
        synthesis.depth = 0; // 0 represents final synthesis
      } catch (parseError) {
        console.error('Raw synthesis response:', response);
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
    // If we have parent synthesis with high confidence, we might have enough info
    if (
      input.parentSynthesis &&
      input.parentSynthesis.confidence >= confidenceThreshold
    ) {
      // Check if we have a good variety of themes and insights
      const hasSubstantiveContent =
        input.parentSynthesis.keyThemes.length >= 3 &&
        input.parentSynthesis.insights.length >= 3 &&
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

  async generateComprehensiveSynthesis(
    input: SynthesisInput,
    maxOutputTokens?: number,
    targetLength?: 'concise' | 'standard' | 'detailed' | number
  ): Promise<SynthesisOutput> {
    // Convert targetLength to specific instructions
    let lengthGuidance = '';
    if (targetLength) {
      if (typeof targetLength === 'number') {
        lengthGuidance = `Please aim for approximately ${targetLength} tokens in your response.`;
      } else {
        switch (targetLength) {
          case 'concise':
            lengthGuidance =
              'Please be very concise, focusing only on the most essential information.';
            break;
          case 'standard':
            lengthGuidance =
              'Please provide a balanced synthesis with moderate detail.';
            break;
          case 'detailed':
            lengthGuidance =
              'Please provide a comprehensive analysis with substantial detail.';
            break;
        }
      }
    }

    // Add both constraints to the prompt
    const outputConstraints = `
${
  maxOutputTokens
    ? `IMPORTANT: Your response must not exceed ${maxOutputTokens} tokens.`
    : ''
}
${lengthGuidance}
    `.trim();

    // Combine all results and parent synthesis (if available)
    const combinedContent = input.results
      .map((result) => {
        return `
Question: ${result.question.question}
Overview: ${result.searchResults.ai_overview}
      `;
      })
      .join('\n\n');

    const parentContent = input.parentSynthesis
      ? `
Previous Analysis: ${input.parentSynthesis.analysis}
Previous Key Themes: ${input.parentSynthesis.keyThemes.join(', ')}
Previous Insights: ${input.parentSynthesis.insights.join(', ')}
Previous Knowledge Gaps: ${input.parentSynthesis.knowledgeGaps.join(', ')}
      `
      : '';

    const systemPrompt = `You are an expert research synthesizer. Your task is to create a final comprehensive synthesis based on all information provided.

Based on the information provided, you will:
1. Create a comprehensive final research analysis that integrates all important findings
2. Identify key overarching themes and patterns across all research
3. Generate high-level insights that aren't explicitly stated in any single result
4. Identify the most significant knowledge gaps that still need to be addressed
5. Highlight the most important conflicting information across sources and provide resolutions where possible
6. Provide a confidence score (0-1) for the overall synthesis

Format your response as a valid JSON object with the following structure:
{
  "analysis": "A comprehensive analysis integrating all findings...",
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
${input.mainPrompt.join('\n')}

${outputConstraints}

${parentContent}

Current Research:
${combinedContent}

Please create a comprehensive final synthesis according to the instructions.`;

    try {
      const combinedPrompt = `${systemPrompt}\n\n${userPrompt}`;
      const response = await this.geminiInstance.generateText(
        combinedPrompt,
        'gemini-2.0-flash'
      );

      let synthesis: SynthesisOutput;
      try {
        const cleanedResponse = cleanJsonResponse(response);
        console.log(`Comprehensive synthesis completed`);

        synthesis = JSON.parse(cleanedResponse);
        synthesis.depth = input.currentDepth;
      } catch (parseError) {
        console.error('Raw synthesis response:', response);
        throw new Error(
          `Failed to parse synthesis response as JSON: ${parseError}`
        );
      }

      return synthesis;
    } catch (error) {
      console.error('Error generating comprehensive synthesis:', error);
      return this.generateDefaultSynthesis(
        input.mainPrompt,
        input.results,
        input.currentDepth
      );
    }
  }
}

export default Synthesizer;

export const generateSynthesisPrompt = ({
  mainPrompt,
  results,
  currentDepth,
  parentSynthesis,
}: {
  mainPrompt: string[];
  results: any[];
  currentDepth: number;
  parentSynthesis?: any;
}) => {
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

  return {
    systemPrompt,
    userPrompt,
  };
};

export const generateReportPrompt = ({
  mainPrompt,
  allSyntheses = [],
  maxOutputTokens,
  targetOutputLength,
  sources = [],
}: {
  mainPrompt: string[];
  allSyntheses: any[];
  maxOutputTokens?: number;
  targetOutputLength?: 'concise' | 'standard' | 'detailed' | number;
  sources?: Array<{
    url: string;
    title: string;
    domain: string;
    ai_overview: string;
    isAcademic?: boolean;
  }>;
}) => {
  // Convert targetLength to specific instructions
  let lengthGuidance = '';
  if (targetOutputLength) {
    if (typeof targetOutputLength === 'number') {
      lengthGuidance = `CRITICAL REQUIREMENT: Your response MUST be at least ${targetOutputLength} tokens long. This is not a suggestion but a strict requirement. Please provide extensive detail, examples, analysis, and elaboration on all aspects of the topic to reach this minimum length. Do not summarize or be concise.`;
    } else {
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

  // Format sources as a numbered bibliography
  const sourcesFormatted =
    sources.length > 0
      ? `\n\nSOURCES (USE THESE EXACT REFERENCES IN YOUR REPORT):\n` +
        sources
          .map(
            (source, index) =>
              `[${index + 1}] ${source.title || 'Unknown Title'}. ${
                source.domain || new URL(source.url).hostname
              }. URL: ${source.url}`
          )
          .join('\n')
      : '';

  const systemPrompt = `You are a world-class research analyst and writer. Your task is to produce a single, cohesive deep research article based on multiple research findings related to a main research topic.

You will:
1. Introduce the topic—outlining scope, importance, and objectives.
2. Synthesize all intermediate analyses, weaving them into a structured narrative.
3. Identify and group the key themes and patterns that emerge across sources.
4. Highlight novel insights your analysis uncovers—points not explicitly stated in any one source.
5. Note contradictions or conflicts in the literature, resolving them or clearly framing open debates.
6. Pinpoint remaining knowledge gaps and recommend avenues for further inquiry.
7. Conclude with a concise summary of findings and practical or theoretical implications.
8. Cite every factual claim or statistic with in-text references (e.g. "[1]", "[2]") and append a numbered bibliography.

CRITICAL: Use ONLY the exact numbered references provided at the end of the prompt. Do not make up or alter references. Each citation like [1], [2], etc. must match the numbered references exactly.

Structure your output exactly like this:
– Title: A descriptive, engaging headline  
– Abstract: 3–5 sentences summary  
– Table of Contents (with section headings)  
– 1. Introduction  
– 2. Background & Literature Review  
– 3. Thematic Synthesis  
 3.1 Theme A  
 3.2 Theme B  
– 4. Novel Insights  
– 5. Conflicting Evidence & Resolutions  
– 6. Knowledge Gaps & Future Directions  
– 7. Conclusion  
– References (use the exact references provided in the prompt)
`;

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
${sourcesFormatted}`;

  return {
    systemPrompt,
    userPrompt,
  };
};

export const generateEvaluationPrompt = ({
  mainPrompt,
  results,
  currentDepth,
  parentSynthesis,
}: {
  mainPrompt: string[];
  results: Array<{
    question: { question: string };
    searchResults: { ai_overview: string };
  }>;
  currentDepth: number;
  parentSynthesis?: {
    analysis: string;
    confidence: number;
    keyThemes: string[];
    knowledgeGaps: string[];
  };
}) => {
  const systemPrompt = `You are an expert research evaluator. Your task is to carefully assess if the current search results provide sufficient information to generate a comprehensive deep research report on the main topic.

Think through this step-by-step:
1. Information coverage: Do the search results cover the main aspects of the topic?
2. Information depth: Is there enough detailed information to create a substantive analysis?
3. Information quality: Are the sources reliable and the information accurate?
4. Knowledge gaps: Are there significant gaps that would prevent a comprehensive report?
5. Potential for additional questions: Could more targeted questions yield better information?

After your careful analysis, provide a confidence score and a clear yes/no determination.
Format your final conclusion exactly like this at the end of your response:

Confidence: [0-1 score]
Sufficient: [true/false]

Where:
- Confidence 0-0.5: Insufficient information, major gaps, needs more research
- Confidence 0.5-0.7: Partial information, some gaps, could benefit from more research
- Confidence 0.7-0.85: Good information, minor gaps, might benefit from targeted research
- Confidence 0.85-1.0: Excellent information, comprehensive coverage, sufficient for a report`;

  const combinedContent = results
    .map((result) => {
      return `
Question: ${result.question.question}
Overview: ${result.searchResults.ai_overview}
      `;
    })
    .join('\n\n');

  const userPrompt = `Main Research Topic(s):
${mainPrompt.join('\n')}

Current Depth Level: ${currentDepth}

${
  parentSynthesis
    ? `Parent Synthesis Analysis: ${parentSynthesis.analysis}
Parent Synthesis Confidence: ${parentSynthesis.confidence}
Parent Synthesis Key Themes: ${parentSynthesis.keyThemes.join(', ')}
Parent Synthesis Knowledge Gaps: ${parentSynthesis.knowledgeGaps.join(', ')}`
    : 'No parent synthesis available.'
}

Search Results:
${combinedContent}

Please evaluate if this information is sufficient to generate a comprehensive research report on the main topic.`;

  return {
    systemPrompt,
    userPrompt,
  };
};

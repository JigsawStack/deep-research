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

export const generateFinalSynthesisPrompt = ({
  mainPrompt,
  allSyntheses = [],
  maxOutputTokens,
  targetOutputLength,
}: {
  mainPrompt: string[];
  allSyntheses: any[];
  maxOutputTokens?: number;
  targetOutputLength?: 'concise' | 'standard' | 'detailed' | number;
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
– References

Additionally, include a JSON metadata section at the end with the following structure:
\`\`\`json
{
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
}
\`\`\``;

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

Please create a final comprehensive research article according to the instructions.`;

  return {
    systemPrompt,
    userPrompt,
  };
};

export const generateComprehensiveSynthesisPrompt = ({
  mainPrompt,
  results,
  currentDepth,
  parentSynthesis,
  maxOutputTokens,
  targetLength,
}: {
  mainPrompt: string[];
  results: any[];
  currentDepth: number;
  parentSynthesis?: any;
  maxOutputTokens?: number;
  targetLength?: 'concise' | 'standard' | 'detailed' | number;
}) => {
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
  const combinedContent = results
    .map((result) => {
      return `
Question: ${result.question.question}
Overview: ${result.searchResults.ai_overview}
    `;
    })
    .join('\n\n');

  const parentContent = parentSynthesis
    ? `
Previous Analysis: ${parentSynthesis.analysis}
Previous Key Themes: ${parentSynthesis.keyThemes.join(', ')}
Previous Insights: ${parentSynthesis.insights.join(', ')}
Previous Knowledge Gaps: ${parentSynthesis.knowledgeGaps.join(', ')}
    `
    : '';

  const systemPrompt = `You are an expert research synthesizer. Your task is to create a comprehensive synthesis based on all information provided.

Based on the information provided, you will:
1. Create a comprehensive research analysis that integrates all important findings
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
${mainPrompt.join('\n')}

${outputConstraints}

${parentContent}

Current Research:
${combinedContent}

Please create a comprehensive synthesis according to the instructions.`;

  return {
    systemPrompt,
    userPrompt,
  };
};

import { WebSearchResult } from "@/types/types";

const RESEARCH_PROMPT_TEMPLATE = ({
  topic,
  pastReasoning,
  pastQueries,
  targetOutputTokens,
}: { topic: string; pastReasoning?: string; pastQueries?: string[]; targetOutputTokens?: number }) => `
You are an AI research assistant. Your primary goal is to construct a comprehensive research plan and a set of effective search queries to thoroughly investigate a given topic.

The topic for research is: ${topic}

${targetOutputTokens ? `The target output number of characters for the report is: ${targetOutputTokens * 4}` : ""}

${pastReasoning ? `Past reasoning: ${pastReasoning}` : ""}

${pastQueries ? `Past queries: ${pastQueries.join(", ")}` : ""}

Please provide the following two components:

1.  **A Detailed Research Plan:**
    *   Clearly outline the overall research strategy and methodology you propose.
    *   Identify key areas, themes, or sub-topics that need to be investigated to ensure comprehensive coverage of the topic.
    *   Suggest the types of information, data, or sources (e.g., academic papers, official reports, news articles, expert opinions) that would be most valuable for this research.
    *   The plan should be logical, actionable, and designed for efficient information gathering.

2.  **A List of Focused Search Queries:**
    *   Generate a list of specific and targeted search queries.
    *   These queries should be optimized to yield relevant, high-quality, and diverse search results from search engines.
    *   The set of queries should collectively aim to cover the main aspects identified in your research plan.
    *   Ensure queries are distinct and avoid redundancy.

3. **Generate how deep the research should be:**
    * Generate a number to determine how deep the research should be to fully explore this topic

4.  **Generate a list of sub-topics to research:**
    * For each level of depth, identify what new information or perspectives should be explored

5. **Generate how broad the research should be:**
    * Generate a number to determine how broad the research should be to fully explore this topic


Your output should empower a researcher to systematically and effectively gather the necessary information to understand the topic in depth.
`;

const DECISION_MAKING_PROMPT = ({
  reasoning,
}: {
  reasoning: string;
}) => `
You are a decision-making assistant.

${getCurrentDateContext()} \n

Chain of Thought:
"""${reasoning}"""

Instructions:
- If the reasoning is sufficient to cover all major sub-topics in deep dive, set "isComplete" to true.
- Otherwise set "isComplete" to false.
- In either case, provide a brief explanation in "reason" describing your judgement.
- **Output only** a JSON object with exactly these two keys and no extra text, for example:
  {
    "isComplete": true,
    "reason": "The reasoning covers all identified gaps and the target length is adequate."
  }
`;

const REASONING_SEARCH_RESULTS_PROMPT = ({
  topic,
  researchPlan,
  searchResults,
  allQueries,
}: {
  topic: string;
  researchPlan: string;
  searchResults: WebSearchResult[];
  allQueries: string[];
}) => `
You are an expert reasoning assistant. Given:

  • Topic to address:
    "${topic}"

  • Proposed research plan:
    """${researchPlan}"""

  • Search results obtained (array of { title, snippet, url }):
    ${JSON.stringify(searchResults, null, 2)}

  • All queries used:
    ${JSON.stringify(allQueries, null, 2)}

${getCurrentDateContext()} \n

Your task is to evaluate whether this set of inputs collectively provides enough coverage and context to write a thorough, deep-dive research report on the topic. Think step by step and show your full chain-of-thought. Specifically:

1. **Decompose** the topic into its major sub-topics or dimensions.
2. **Map** each sub-topic to where (if at all) it is covered by the researchPlan, any of the searchResults, or the queries.
3. **Identify** gaps—sub-topics not covered or weakly supported.
4. **Assess** the quality, relevance, and diversity of the sources provided.
5. **Recommend** additional queries, source types, or angles needed to fill those gaps.
6. **Summarize** at the end with a JSON object containing:
   - sufficiency: "sufficient" or "insufficient"
   - missingAreas: [list of uncovered sub-topics]
   - suggestions: [list of concrete next queries or source types]

Begin by stating "Let me think through this step by step," then proceed with your reasoning.  
`;

// MARKERS
export const CONT = "@@@CONTINUE@@@";
export const REPORT_DONE = "@@@REPORT_DONE@@@";

const INIT_FINAL_REPORT_PROMPT = ({
  topic,
  sources,
  targetOutputTokens,
  latestResearchPlan,
  latestReasoning,
  queries,
  phase,
}: {
  topic: string;
  sources: WebSearchResult[];
  targetOutputTokens?: number;
  latestResearchPlan: string;
  latestReasoning: string;
  queries: string[];
  phase: "initial" | "continuation" | "citation";
}) => {

  const systemPrompt = `
You are a world-class research analyst and writer.\n

1. Synthesize intermediate analyses into a structured narrative.\n
2. Identify and group key themes and patterns across sources.\n
3. Each topic should be a deep dive paragraph, not a bullet point list.\n
4. Each topic will not be repeated in the report. So make sure to cover all the topics, diving deep into each one.\n
5. Do not worry about covering all the topics, just dive deep into each topic.\n
6. **ONLY WRITE THE HEADINGS AND BODY OF THE REPORT. DO NOT START THE CONCLUSION OR BIBLIOGRAPHY IN THIS RESPONSE.**\n
7. Cite every factual claim or statistic with in-text references using the reference numbers by the sources provided (e.g. "[1]").\n
8. Do not cite multiple sources at the same time. For instance if [1, 2, 3], then cite [1], then [2], then [3].\n
9 Use reference numbers [X] for sources instead of URLs\n
10 **For multiple sources, each source should have it's own bracket []. Something like this: [1][2][3].**\n
11. **Never repeat a heading that is already present in the Existing Draft.**\n

THIS IS VERY IMPORTANT:\n
• Always finish this response by outputting ${CONT} alone—no other markers.\n
• Do not start the "Conclusion" or "Bibliography" sections in this response.\n
`.trim();

  const userPrompt = `
${targetOutputTokens ? `Target length:
≈ ${(targetOutputTokens * 4).toLocaleString()} characters (${targetOutputTokens} tokens ×4)` : ""}

**CONTEXT**:\n
  Latest Research Plan:\n
  ${latestResearchPlan}\n

  Latest Reasoning Snapshot:\n
  ${latestReasoning}\n

  Sub-Queries and Sources:\n
  ${queries.map((q, i) => {
    const source = sources[i];
    if (source) {
      const overview = source.searchResults.ai_overview ? `\n   AI Overview: ${source.searchResults.ai_overview.substring(0, 150)}...` : '';
      const urls = source.searchResults.results.map(r => `   [${r.referenceNumber}] ${r.title || 'No title'} (${r.url})`).join('\n');
      return `${i + 1}. **${q}** → ${source.searchResults.results.length} hits${overview}\n${urls}`;
    }
    return `${i + 1}. **${q}** (No sources found)`;
  }).join('\n\n')}

────────────────────────────────────────
**Write-phase instruction:**  

${`🔒 You still need roughly ${remaining.toLocaleString()} more characters before concluding.\n
**Do NOT start the "Conclusion" or "Bibliography" sections in this response.**`}\n
\n

- Finish by outputting ${CONT} alone.\n

User Prompt/Topic/Question:
${topic}

`.trim();

  return {
    system: systemPrompt,
    user: userPrompt,
  };
};

const CONTINUE_FINAL_REPORT_PROMPT = ({
  topic,
  sources,
  targetOutputTokens,
  currentReport,
  currentOutputLength,
  latestResearchPlan,
  latestReasoning,
  queries,
}: {
  topic: string;
  sources: WebSearchResult[];
  targetOutputTokens?: number;
  currentReport: string;
  currentOutputLength: number;
  latestResearchPlan: string;
  latestReasoning: string;
  queries: string[];
}) => {
  const targetChars = targetOutputTokens * 4;
  const remaining = Math.max(targetChars - currentOutputLength, 0);
  const atTarget = currentOutputLength >= targetChars;

  /* ───────── SYSTEM prompt ───────── */
  const systemPrompt = `
You are a world-class research analyst expanding an existing draft.\n

1. Continue seamlessly—never restart or duplicate headings.\n
2. Write in the same style as the existing draft.\n
3. Note contradictions or conflicts, resolving them or framing open debates.\n
4. Each topic should be a deep dive paragraph, not a bullet point list.\n
5. Each topic will not be repeated in the report. So make sure to cover all the topics, diving deep into each one.\n
6. Do not worry about covering all the topics, just dive deep into each topic.\n
7. ** YOU MUST: ** Cite every factual claim or statistic with in-text references using the reference numbers by the sources provided (e.g. "[1]").\n
8. ** For multiple sources, each source should have it's own bracket []. Something like this: [1][2][3].**\n
9. **USE ONLY THE SOURCES PROVIDED.** There should be no other sources than the ones provided.\n
10. **Never repeat a heading that is already present in the Existing Draft. Even if it is to continue the topic.**\n
11/ If **${atTarget ? "we have reached the target length" : "we have not yet reached the target"}**, follow the instructions below.\n 
`.trim();

  /* ───────── USER prompt ───────── */
  const userPrompt = `
Main Research Topic:\n
${topic}\n

Current draft length:\n
${currentOutputLength.toLocaleString()} chars\n

Target length:\n
≈ ${targetChars.toLocaleString()} chars\n

Current Draft:\n
${currentReport}

────────────────────────────────────────
Latest Research Plan:\n
${latestResearchPlan}\n

Latest Reasoning Snapshot:\n
${latestReasoning}\n

Sub-Queries:\n
${queries.map((q) => `- ${q}`).join("\n")}\n

Source Pack (for quick reference):\n
${sources.map((s, i) => {
  const overview = s.searchResults.ai_overview ? `\n   AI Overview: ${s.searchResults.ai_overview.substring(0, 150)}...` : '';
  const urls = s.searchResults.results.map(r => `   [${r.referenceNumber}] ${r.title || 'No title'} (${r.url})`).join('\n');
  return `${i + 1}. **${s.question}** → ${s.searchResults.results.length} hits${overview}\n${urls}`;
}).join('\n\n')}

────────────────────────────────────────
${
  !atTarget
    ? `🔒 **Continue body sections only.** You still need ≈${remaining.toLocaleString()} characters.  
       Finish this response by outputting ${CONT} alone. DO NOT START THE CONCLUSION OR BIBLIOGRAPHY IN THIS RESPONSE.`
    : `✅ **Target reached.** Now write the **Conclusion** in full, DO NOT START THE BIBLIOGRAPHY IN THIS RESPONSE.
       and finish by outputting ${REPORT_DONE} alone.`
}
`.trim();

  return {
    system: systemPrompt,
    user: userPrompt,
  };
};

const FINAL_REPORT_PROMPT = ({
  topic,
  sources,
  targetOutputTokens,
  latestResearchPlan,
  latestReasoning,
  queries,
  phase,
  currentReport,
}: {
  topic: string;
  sources: WebSearchResult[];
  targetOutputTokens?: number;
  latestResearchPlan: string;
  latestReasoning: string;
  queries: string[];
  currentReport: string;
  phase: "initial" | "continuation" | "citation";
}) => {
  const systemPrompt = ``;
  const userPrompt = `
  ${targetOutputTokens ? `Target length:
    ≈ ${(targetOutputTokens * 4).toLocaleString()} characters (${targetOutputTokens} tokens ×4)` : ""}

  **CONTEXT**:\n
    Latest Research Plan:\n
    ${latestResearchPlan}\n

    Latest Reasoning Snapshot:\n
    ${latestReasoning}\n

    Sub-Queries:\n
    ${queries.map((q) => `- ${q}`).join("\n")}\n


    Source Pack (for quick reference):\n
    ${sources.map((s, i) => {
      const overview = s.searchResults.ai_overview ? `\n   AI Overview: ${s.searchResults.ai_overview.substring(0, 150)}...` : '';
      const urls = s.searchResults.results.map(r => `   [${r.referenceNumber}] ${r.title || 'No title'} (${r.url})`).join('\n');
      return `${i + 1}. **${s.question}** → ${s.searchResults.results.length} hits${overview}\n${urls}`;
    }).join('\n\n')}
  `;


}


/**
 * Core prompt function that adds current date information to all prompts
 * This ensures all models have the correct temporal context for research
 */
const getCurrentDateContext = () => {
  return `Current datetime is: ${new Date().toISOString()}`;
};

// Export all prompts together with date context
export const PROMPTS = {
  research: RESEARCH_PROMPT_TEMPLATE,
  reasoningSearchResults: REASONING_SEARCH_RESULTS_PROMPT,
  decisionMaking: DECISION_MAKING_PROMPT,
  initFinalReport: INIT_FINAL_REPORT_PROMPT,
  continueFinalReport: CONTINUE_FINAL_REPORT_PROMPT,
  finalReport: FINAL_REPORT_PROMPT,
};

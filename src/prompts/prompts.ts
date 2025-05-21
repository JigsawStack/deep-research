import { WebSearchResult } from "@/types/types";

const RESEARCH_PROMPT_TEMPLATE = ({
  topic,
  pastReasoning,
  pastQueries,
  targetOutputTokens,
}: { topic: string; pastReasoning?: string; pastQueries?: string[]; targetOutputTokens?: number }) => `
You are an AI research assistant. Your primary goal is to construct a comprehensive research plan and a set of effective search queries to thoroughly investigate a given topic.\n

The topic for research is: ${topic}\n

${targetOutputTokens ? `The target output number of characters for the report is: ${targetOutputTokens * 4}` : "Determine the target output number of characters for the report based on the topic and the past reasoning and queries."}\n

${pastReasoning ? `Past reasoning: ${pastReasoning}` : ""}\n

${pastQueries ? `Past queries: ${pastQueries.join(", ")}` : ""}\n


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

Current datetime is: ${new Date().toISOString()}

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
  queries,
}: {
  topic: string;
  researchPlan: string;
  searchResults: WebSearchResult[];
  queries: string[];
}) => `
You are an expert reasoning assistant. 

  • Topic to address:
    "${topic}"

  • Proposed research plan:
    """${researchPlan}"""

  Sub-Queries and Sources:\n
  ${queries.map((q, i) => {
    const source = searchResults[i];
    if (source) {
      const overview = source.searchResults.ai_overview ? `\n   AI Overview: ${source.searchResults.ai_overview.substring(0, 150)}...` : '';
      const urls = source.searchResults.results.map(r => `   [${r.referenceNumber}] ${r.title || 'No title'} (${r.url})`).join('\n');
      return `${i + 1}. **${q}** → ${source.searchResults.results.length} hits${overview}\n${urls}`;
    }
    return `${i + 1}. **${q}** (No sources found)`;
  }).join('\n\n')}
    

Current datetime is: ${new Date().toISOString()} \n

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
  phase: "initial" | "continuation";
}) => {
  const targetChars = targetOutputTokens ? targetOutputTokens * 4 : undefined;
  const remaining = targetChars ? Math.max(targetChars - currentReport.length, 0) : undefined;
  const atTarget = targetChars ? currentReport.length >= targetChars : undefined;

  console.log(targetChars, remaining, atTarget);

  // Determine instructions based on phase
  let phaseInstructions = '';
  switch (phase) {
    case "initial":
      phaseInstructions = `
        Finish by outputting ${CONT} alone.\n
      `;
      break;
      
    case "continuation":
      if (atTarget === false) {
        phaseInstructions = `
          ${remaining ? `You still need ≈${remaining.toLocaleString()} characters.` : ""}
          Finish by outputting ${CONT} alone.\n
          ${console.log("HERE Remaining", remaining)}
        `;
      } else {
        phaseInstructions = `
          - This is your FINAL response for this question.\n
          - If the provided sources are insufficient to determine a definitive answer, make your best educated guess based on your understanding of the topic, clearly stating that it's a reasoned guess due to limited source information.\n
          - For multiple-choice questions where sources don't provide a direct answer, analyze each option and select the most likely one based on your knowledge.\n
          - YOU MUST conclude your answer now, regardless of whether you feel it's complete.\n
          - YOU MUST end your response with ${REPORT_DONE} on its own line.\n
          Finish by outputting ${REPORT_DONE} alone.\n
          ${console.log("HERE At Target", atTarget)}
        `;
      }
      break;
  }

  const systemPrompt = `
  You are a world-class research analyst and writer.\n 
  Your primary purpose is to help users answer their prompts.\n

  - Cite every factual claim or statistic with in-text references using the reference numbers by the sources provided (e.g. "[1]").\n
  - Use reference numbers [X] for sources instead of URLs\n
  - For multiple sources, each source should have it's own bracket []. Something like this: [1][2][3].\n
  - **Never repeat a heading that is already present in the Existing Draft.**\n
  - If sources don't provide enough information for a definitive answer, you may use your general knowledge to make an educated guess, clearly indicating when you do so.\n
  `;

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
        return `${i + 1}. **${q}**${overview}\n${source.searchResults.results.map(r => `   [${r.referenceNumber}] ${r.title || 'No title'} (${r.url})`).join('\n')}`;
      }
      return `${i + 1}. **${q}** (No sources found)`;
    }).join('\n\n')}

    ${currentReport ? `Current Draft:\n${currentReport}` : ""}
    
    ${phaseInstructions}

  Main User Prompt:\n
  ${topic}\n
  `.trim();

  return {
    system: systemPrompt,
    user: userPrompt,
  };
};


// Export all prompts together with date context
export const PROMPTS = {
  research: RESEARCH_PROMPT_TEMPLATE,
  reasoningSearchResults: REASONING_SEARCH_RESULTS_PROMPT,
  decisionMaking: DECISION_MAKING_PROMPT,
  finalReport: FINAL_REPORT_PROMPT,
};

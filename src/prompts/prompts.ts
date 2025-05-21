// **(TODO)**
// Keep naming consistent 
import { WebSearchResult } from "@/types/types";

const RESEARCH_PROMPT_TEMPLATE = ({
  topic,
  pastReasoning,
  pastQueries,
  pastSources,
  targetOutputTokens,
}: { topic: string; pastReasoning?: string; pastQueries?: string[]; pastSources?: WebSearchResult[]; targetOutputTokens?: number }) => `
You are a world-class research planner.\n
Your primary goal is to construct a comprehensive research plan and a set of effective search queries to thoroughly investigate the given topic.\n


The topic is: ${topic}\n

${pastReasoning ? `Past reasoning: ${pastReasoning}` : ""}\n

Past Queries and Sources:\n
${pastQueries?.map((q, i) => {
  const source = pastSources?.[i];
  if (source) {
    const overview = source.searchResults.ai_overview ? `\n   AI Overview: ${source.searchResults.ai_overview.substring(0, 150)}...` : '';
    return `${i + 1}. **${q}**${overview}\n${source.searchResults.results.map(r => `   [${r.referenceNumber}] ${r.title || 'No title'} (${r.url})`).join('\n')}`;
  }
  return `${i + 1}. **${q}** (No sources found)`;
}).join('\n\n') || ''}


Please provide the following components:

1. A Detailed Research Plan:\n
    - Clearly outline the overall research strategy and methodology you propose.\n
    - Identify key areas, themes, or sub-topics that need to be investigated to ensure comprehensive coverage of the topic.\n
    - Suggest the types of information, data, or sources (e.g., academic papers, official reports, news articles, expert opinions) that would be most valuable for this research.\n
    - The plan should be logical, actionable, and designed for efficient information gathering.\n

2. A List of Focused Search Queries:\n
    - Generate a list of specific and targeted search queries.\n
    - These queries should be optimized to yield relevant, high-quality, and diverse search results from search engines.\n
    - The set of queries should collectively aim to cover the main aspects identified in your research plan.\n
    - Ensure queries are distinct and avoid redundancy.\n
  
3. Generate how deep the research should be:\n
    - Generate a number to determine how deep the research should be to fully explore this topic\n

4. Generate how broad the research should be:\n
    - Generate a number to determine how broad the research should be to fully explore this topic\n

${targetOutputTokens ? ``:`
  5. Generate the target output number of characters for the report:\n
    - If the topic requires in depth searching for reading materials and the output is expected to be large, you must set the target output number of tokens to a number that you think works best.
  
  `}
`;

const DECISION_MAKING_PROMPT = ({
  reasoning,
}: {
  reasoning: string;
}) => `
You are a world-class decision-making researcher.\n

Current datetime is: ${new Date().toISOString()}\n

Chain of Thought:\n
"""${reasoning}"""\n

INSTRUCTIONS:\n
- If the reasoning is sufficient to cover all major sub-topics in deep dive, set "isComplete" to true.\n
- Otherwise set "isComplete" to false.\n
- In either case, provide a brief explanation in "reason" describing your judgement.\n
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
You are an world-class reasoning researcher.\n

  • Topic to address:\n
    "${topic}"\n

  • Proposed research plan:\n
    """${researchPlan}"""\n

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

INSTRUCTIONS:\n
Your task is to evaluate whether this set of queries and sources collectively provides enough coverage
to answer the topic. Think step by step and show your full chain-of-thought. \n

Specifically:\n
1. **Decompose** the topic into its major sub-topics or dimensions.\n
2. **Map** each sub-topic to where (if at all) it is covered by the researchPlan, any of the searchResults, or the queries.\n
3. **Identify** gaps—sub-topics not covered or weakly supported.\n
4. **Assess** the quality, relevance, and diversity of the sources provided.\n
5. **Recommend** additional queries, source types, or angles needed to fill those gaps.\n
6. **Summarize** at the end with a JSON object containing:\n
   - sufficiency: "sufficient" or "insufficient"\n
   - missingAreas: [list of uncovered sub-topics]\n
   - suggestions: [list of concrete next queries or source types]\n

Begin by stating "Let me think through this step by step," then proceed with your reasoning.\n
`;

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
  phase: "initial" | "continuation" ;
}) => {
  const targetChars = targetOutputTokens ? targetOutputTokens * 4 : undefined;
  const remaining = targetChars ? Math.max(targetChars - currentReport.length, 0) : undefined;
  const atTarget = targetChars ? currentReport.length >= targetChars : undefined;

  const systemPrompt = `
  You are a world-class analyst.\n 
  Your primary purpose is to help users answer their topic/queries.\n

  GENERAL GUIDELINES:\n
    - If you are about to reach your output token limit, ensure you properly close all JSON objects and strings to prevent parsing errors.\n
    - Cite every factual claim or statistic with in-text references using the reference numbers by the sources provided (e.g. "[1]").\n
    - Do not include external sources apart from the provided sources in the context.\n
    - Use reference numbers [X] for sources instead of URLs\n
    - For multiple sources, each source should have it's own bracket []. Something like this: [1][2][3].\n
    - **Never repeat a heading that is already present in the Existing Draft.**\n

  INSTRUCTIONS:\n
    - Make sure your report is addressing the topic/queries.\n
    - Make sure your report is comprehensive and covers all the sub-topics.\n
    - Make sure your report is well-researched and well-cited.\n
    - Make sure your report is well-written and well-structured.\n
    - Make sure your report is well-organized and well-formatted.\n
  `;

  // Determine instructions based on phase
  let phaseInstructions = '';
  switch (phase) {
    case "initial":
      phaseInstructions = `
        Return phase as "continuation"\n
      `;
      break;
      
    case "continuation":
      if (atTarget === false) {
        phaseInstructions = `
          Generate a continuation of the report. No need to include the initial report.\n
          ${remaining ? `You still need ≈${remaining.toLocaleString()} characters.` : ""}\n
          Return phase as "continuation"\n
        `;
      } else {
        phaseInstructions = `
          - This is your FINAL response for this question.\n
          - If the provided sources are insufficient, make your best educated guess and give a definitive answer.\n
          - For multiple-choice questions where sources don't provide a direct answer, analyze each option and select the most likely one based on your knowledge.\n
          - YOU MUST conclude your answer now, regardless of whether you feel it's complete.\n

          Return phase as "done"\n
        `;
      }
      break;
  }

  const userPrompt = `
  ${targetOutputTokens ? `Target length:
    ≈ ${(targetOutputTokens * 4).toLocaleString()} characters (${targetOutputTokens} tokens ×4)` : ""}

  CONTEXT:\n
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
    
    ${phaseInstructions}\n

  Main Topic:\n
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

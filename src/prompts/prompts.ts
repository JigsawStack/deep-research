import { ResearchSource, WebSearchResult } from "@/types/types";

const CONTEXT_GENERATION_PROMPT = ({
  topic,
  queries,
  sources,
}: { topic: string; queries: string[]; sources: ResearchSource[] }) => `
You are a world-class context generator.\n
Your task is to generate a context overview for the following queries and sources that relates to the main topic:\n
Extract all all the information from the sources that is relevant to the main topic.\n

Main Topic:\n
${topic}\n

Sub-Queries and Sources:\n
${queries?.map((q) => {
  const sourcesForQuery = sources?.filter(s => s.url && s.url.length > 0);
  if (sourcesForQuery && sourcesForQuery.length > 0) {
    return `**${q}**\n${sourcesForQuery.map(r => `   
    [${r.referenceNumber}] ${r.title || 'No title'} (${r.url})\n      
    Content: ${r.content ? r.content : 'No content available'}`).join('\n')}`;
  }
  return `**${q}** (No sources found)`;
}).join('\n\n')}
`.trim();

const RESEARCH_PROMPT_TEMPLATE = ({
  topic,
  pastReasoning,
  pastQueries,
  pastSources,
}: { topic: string; pastReasoning?: string; pastQueries?: string[]; pastSources?: WebSearchResult[] }) => `
You are a world-class research planner.\n
Your primary goal is to construct a comprehensive research plan and a set of effective search queries to thoroughly investigate the given topic.\n


The topic is: ${topic}\n

${pastReasoning ? `Past reasoning: ${pastReasoning}` : ""}\n

Sub-Queries and Sources:\n
${pastQueries?.map((q, i) => {
  const source = pastSources?.[i];
  if (source) {
    return `${i + 1}. **${q}**\n${source.searchResults.results.map(r => `   
    [${r.referenceNumber}] ${r.title || 'No title'} (${r.url})\n      
    Content: ${r.content ? r.content : 'No content available'}`).join('\n')}`;
  }
  return `${i + 1}. **${q}** (No sources found)`;
}).join('\n\n')}


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
`.trim();

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
`.trim();

const REASONING_SEARCH_RESULTS_PROMPT = ({
  topic,
  researchPlan,
  queries,
  sources,
  contentLength = 1000,
}: {
  topic: string;
  researchPlan: string;
  queries: string[];
  sources: WebSearchResult[];
  contentLength?: number;
}) => `
You are an world-class reasoning researcher.\n

  • Topic to address:\n
    "${topic}"\n

  • Proposed research plan:\n
    """${researchPlan}"""\n

      Sub-Queries and Sources:\n
    ${queries.map((q, i) => {
      const source = sources[i];
      if (source) {
        return `${i + 1}. **${q}**\n${source.searchResults.results.map(r => `   
        [${r.referenceNumber}] ${r.title || 'No title'} (${r.url})\n      
        Content: ${r.content ? r.content.substring(0, contentLength) + '...' : 'No content available'}`).join('\n')}`;
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
`.trim();

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
    - Only use the sources provided in the context.\n
    - Cite every factual claim or statistic with in-text references using the reference numbers by the sources provided (e.g. "[1]").\n
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
          - If the provided sources are insufficient, give your best definitive answer.\n
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
        return `${i + 1}. **${q}**\n${source.searchResults.results.map(r => `   
        [${r.referenceNumber}] ${r.title || 'No title'} (${r.url})\n      
        Content: ${r.content ? r.content : 'No content available'}`).join('\n')}`;
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
  contextGeneration: CONTEXT_GENERATION_PROMPT,
};

import { ResearchSource, WebSearchResult } from "@/types/types";

const CONTEXT_GENERATION_PROMPT = ({
  topic,
  queries,
  research_sources,
}: { topic: string; queries: string[]; research_sources: ResearchSource[] }) => `
You are a world-class context generator.\n
Your task is to generate a context overview for the following queries and sources that relates to the main topic:\n
Extract all the information from the sources that is relevant to the main topic.\n

Main Topic:\n
${topic}\n

Sub-Queries and Sources:\n
${queries?.map((q) => {
  const sourcesForQuery = research_sources?.filter(s => s.url && s.url.length > 0);
  if (sourcesForQuery && sourcesForQuery.length > 0) {
    return `**${q}**\n${sourcesForQuery.map(r => `   
    [${r.referenceNumber}] ${r.title || 'No title'} (${r.url})\n      
    Content and Snippets: ${r.content ? r.content : r.snippets?.join('\n')}`).join('\n')}`;
  }
  return `**${q}** (No sources found)`;
}).join('\n\n')}
`.trim();

const RESEARCH_PROMPT_TEMPLATE = ({
  topic,
  reasoning,
  queries,
  sources,
}: { topic: string; reasoning?: string; queries?: string[]; sources?: WebSearchResult[] }) => {
  const systemPrompt = `
  You are a world-class research planner.\n
  Your primary goal is to construct a comprehensive research plan and a set of effective search queries to thoroughly investigate the given topic.\n

  INSTRUCTIONS:\n
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
    
  OUTPUT:\n
    - A JSON object with the following keys:\n
      - "researchPlan": A detailed research plan\n
      - "queries": A list of search queries\n
      - "depth": A number representing the depth of the research\n
      - "breadth": A number representing the breadth of the research\n
  `.trim();

  const userPrompt = `
The topic is: ${topic}\n

${reasoning ? `Past reasoning: ${reasoning}` : ""}\n

${queries ? `
Sub-Queries and Sources:
${queries.map((q) => {
  const sourcesForQuery = sources?.find(s => s.query === q);
  if (sourcesForQuery && sourcesForQuery.searchResults.results.length > 0) {
    return `**${q}**\n${sourcesForQuery.searchResults.results.map(r => `   
    [${r.referenceNumber}] ${r.title || 'No title'} (${r.url})\n      
    Content and Snippets: ${r.content ? r.content : r.snippets?.join('\n')}`).join('\n')}`;
  }
  return `**${q}** (No sources found)`;
}).join('\n\n')}` : ''}
  `.trim();

  return {
    system: systemPrompt,
    user: userPrompt,
  };
};

const DECISION_MAKING_PROMPT = ({
  topic,
  reasoning,
}: {
  reasoning: string;
  topic: string;
}) => {
  const systemPrompt = `
You are a world-class analyst.\n
Your primary purpose is to help decide if the reasoning is sufficient to answer the main topic.\n

Current datetime is: ${new Date().toISOString()}\n

INSTRUCTIONS:\n
- If the reasoning is sufficient to answer the main topic set "isComplete" to true.\n
- In either case, provide a brief explanation in "reason" describing your judgement.\n
- **Output only** a JSON object with exactly these two keys and no extra text, for example:
  {
    "isComplete": true,
    "reason": "The reasoning is sufficient to answer the main topic."
  }
`.trim();

  const userPrompt = `
Chain of Thought:\n
"""${reasoning}"""\n

Main Topic:\n
${topic}\n
`.trim();

  return {
    system: systemPrompt,
    user: userPrompt,
  };
};

const REASONING_SEARCH_RESULTS_PROMPT = ({
  topic,
  researchPlan,
  queries,
  sources,
}: {
  topic: string;
  researchPlan: string;
  queries: string[];
  sources: WebSearchResult[];
}) => {
  const systemPrompt = `
You are a world-class analyst.\n
Your primary purpose is to help reason if the the topic, 
queries, sources, and research plan are sufficient to answer the main topic.\n

INSTRUCTIONS:\n
- Think step by step and show your full chain-of-thought. \n
- Specifically, decompose the topic into its major sub-topics or dimensions.\n
- Map each sub-topic to where (if at all) it is covered by the researchPlan, any of the searchResults, or the queries.\n
- Assess the quality, relevance, and diversity of the sources provided.\n
- Identify gaps—sub-topics not covered or weakly supported.\n
- Recommend additional queries, source types, or angles needed to fill those gaps.\n
  `.trim();

  const userPrompt = `
Proposed research plan:\n
"""${researchPlan}"""\n

Context for each query:\n
${queries?.map((q) => {
  const sourcesForQuery = sources?.find(s => s.query === q);
  if (sourcesForQuery) {
    return `**Query: ${q}**\n
    Context: ${sourcesForQuery.context}\n
    URLs: ${sourcesForQuery.searchResults.results.map(r => r.url).join(', ')}`;
  } else {
    throw new Error(`No sources found for query: ${q}`);
  }
}).join('\n\n')}

Main Topic:\n
"${topic}"\n

Begin by stating "Let me think through this step by step," then proceed with your reasoning.\n
  `.trim();

  return {
    system: systemPrompt,
    user: userPrompt,
  };
}

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
    ${queries?.map((q) => {
      const sourcesForQuery = sources?.find(s => s.query === q);
      if (sourcesForQuery && sourcesForQuery.searchResults.results.length > 0) {
        return `**${q}**\n${sourcesForQuery.searchResults.results.map(r => `   
        [${r.referenceNumber}] ${r.title || 'No title'} (${r.url})\n      
        Content and Snippets: ${r.content ? r.content : r.snippets?.join('\n')}`).join('\n')}`;
      }
      return `**${q}** (No sources found)`;
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

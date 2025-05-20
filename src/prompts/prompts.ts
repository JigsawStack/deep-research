import { WebSearchResult } from "@/types/types";

const RESEARCH_PROMPT_TEMPLATE = ({
  topic,
  pastReasoning,
  pastQueries,
  maxDepth,
  maxBreadth,
  targetOutputTokens,
}: { topic: string; pastReasoning?: string; pastQueries?: string[]; maxDepth: number; maxBreadth: number; targetOutputTokens: number }) => `
You are an AI research assistant. Your primary goal is to construct a comprehensive research plan and a set of effective search queries to thoroughly investigate a given topic.

The topic for research is: ${topic}

The target output number of characters for the report is: ${targetOutputTokens * 4}

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
     
3.  **Generate a list of sub-topics to research:**
    * Determine how many iterations of research are needed (depth) to fully explore this topic
    * For each level of depth, identify what new information or perspectives should be explored
     
4. **Generate how deep the research should be:**
    * Generate a number between 1-${maxDepth}, where 1 is surface-level and ${maxDepth} is the max thoroughness 
    * This number represents how deep the research should be

5. **Generate how broad the research should be:**
    * Generate a number between 1-${maxBreadth}, where 1 is surface-level and ${maxBreadth} is the max thoroughness 
    * This number represents how broad the research should be

Your output should empower a researcher to systematically and effectively gather the necessary information to understand the topic in depth.
`;

const DECISION_MAKING_PROMPT = ({
  reasoning,
  targetOutputTokens,
}: {
  reasoning: string;
  targetOutputTokens: number;
}) => `
You are a decision-making assistant.

Your job is to decide whether the provided chain-of-thought reasoning gives enough context to start writing the 
final report of approximately ${targetOutputTokens * 4} characters.

Chain of Thought:
"""${reasoning}"""

Instructions:
- If the reasoning is sufficient to cover all major sub-topics at the planned length, set "isComplete" to true.
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

const EVALUATION_PROMPT = ({
  prompt,
  researchPlan,
  allQueries,
  resultsSummary,
}: {
  prompt: string;
  researchPlan: string;
  allQueries: string[];
  resultsSummary: string;
}) => {
  return `
    You are an expert research planner. Your task is to analyze search results evaluate them and generate targeted follow-up questions to explore knowledge gaps or go deeper into interesting aspects.

    PROCESS:
    1. Identify ALL information explicitly requested in the original research goal
    2. Analyze what specific information has been successfully retrieved in the search results
    3. Identify ALL information gaps between what was requested and what was found
    4. For entity-specific gaps: Create targeted queries for each missing attribute of identified entities
    5. For general knowledge gaps: Create focused queries to find the missing conceptual information

    QUERY GENERATION RULES:
    - For missing entity attributes:
      * Create direct queries for each entity-attribute pair (e.g., "LeBron James height")
    - For general knowledge gaps:
      * Create focused queries addressing each conceptual gap (e.g., "criteria for ranking basketball players")
    - Construct queries to retrieve EXACTLY the missing information
    - Exclude information not required by the original research goal
    - Prioritize queries for the most critical missing information first
    
    FOLLOW-UP QUESTIONS CRITERIA:
    - Target specific knowledge gaps in current results
    - Focus on unexplored but relevant aspects
    - Be specific enough to yield useful information
    - Avoid repeating already covered information
    - Phrase as clear, direct questions

    ${getCurrentDateContext()}

    OUTPUT FORMAT:
    First, briefly state:
    1. What specific information was found
    2. What specific information is still missing
    3. What type of knowledge gaps exist (entity-specific or general knowledge)

    Then provide up to 5 targeted queries that directly address the identified gaps, ordered by importance. Please consider that you
    need to generate queries that tackle a single goal at a time (searching for A AND B will return bad results). Be specific!


    <Research Topic>${prompt}</Research Topic>

    <Research Plan>${researchPlan}</Research Plan>

    <Search Queries Used>${allQueries.join(", ")}</Search Queries Used>
    
    <Current Search Results Summary>${resultsSummary}</Current Search Results Summary>
    
    Based on the above information, evaluate if we have sufficient research coverage or need additional queries.
    Identify which aspects of the research plan have been covered and which areas still need investigation.
    
    Your response MUST be formatted exactly as follows:
    
    IS_COMPLETE: [true or false]
    REASON: [Your detailed reasoning for why the research is complete or not]
    QUERIES: [If IS_COMPLETE is false, provide a JSON array of additional search queries like ["query1", "query2"]. If complete, use empty array []]
    
    Please ensure there are no thinking tags, reasoning sections, or other markup in your response.`;
};

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
}: {
  topic: string;
  sources: WebSearchResult[];
  targetOutputTokens: number;
  latestResearchPlan: string;
  latestReasoning: string;
  queries: string[];
}) => {
  const targetChars = targetOutputTokens * 4;
  const remaining = targetChars;

  const systemPrompt = `
You are a world-class research analyst and writer. Produce a single, cohesive deep-research paper.\n

1. Introduce the topic—outlining scope, importance, and objectives.\n
2. Synthesize intermediate analyses into a structured narrative.\n
3. Identify and group key themes and patterns across sources.\n
4. Highlight novel insights not explicitly stated in any single source.\n
5. Note contradictions or conflicts, resolving them or framing open debates.\n
6. Each topic should be a deep dive paragraph, not a bullet point list.\n
7. Each topic will not be repeated in the report. So make sure to cover all the topics, diving deep into each one.\n
8. Do not worry about covering all the topics, just dive deep into each topic.\n
9. **ONLY WRITE THE HEADINGS AND BODY OF THE REPORT. DO NOT START THE CONCLUSION OR BIBLIOGRAPHY IN THIS RESPONSE.**\n
10. Cite every factual claim or statistic with in-text references using the reference numbers by the sources provided (e.g. "[1]").\n
11. Do not cite multiple sources at the same time. For instance if [1, 2, 3], then cite [1], then [2], then [3].\n
12. **Never repeat a heading that is already present in the Existing Draft.**\n

THIS IS VERY IMPORTANT:\n
• Always finish this response by outputting ${CONT} alone—no other markers.\n
• Do not start the "Conclusion" or "Bibliography" sections in this response.\n
`.trim();

  const userPrompt = `
Main Research Topic:
${topic}

Target length:
≈ ${targetChars.toLocaleString()} characters (${targetOutputTokens} tokens ×4)

Current draft length:
0 characters (start of article)

Latest Research Plan:
${latestResearchPlan}

Latest Reasoning Snapshot:
${latestReasoning}

Sub-Queries:
${queries.map((q) => `- ${q}`).join("\n")}

Source Pack (for quick reference):
${sources.map((s, i) => {
  const overview = s.searchResults.ai_overview ? `\n   AI Overview: ${s.searchResults.ai_overview.substring(0, 150)}...` : '';
  const urls = s.searchResults.results.map(r => `   [${r.referenceNumber}] ${r.title || 'No title'} (${r.url})`).join('\n');
  return `${i + 1}. **${s.question}** → ${s.searchResults.results.length} hits${overview}\n${urls}`;
}).join('\n\n')}

────────────────────────────────────────
**Write-phase instruction:**  

${`🔒 You still need roughly ${remaining.toLocaleString()} more characters before concluding.\n
**Do NOT start the "Conclusion" or "Bibliography" sections in this response.**`}\n
\n
**Remember:** \n
- Use reference numbers [X] for sources instead of URLs\n
- ** For multiple sources, each source should have it's own bracket []. Something like this: [1][2][3].**\n
- Finish by outputting ${CONT} alone.\n
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
  targetOutputTokens: number;
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


/**
 *
 *
 * Core prompt function that adds current date information to all prompts
 * This ensures all models have the correct temporal context for research
 */
const getCurrentDateContext = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1; // JavaScript months are 0-indexed
  const day = now.getDate();
  const monthName = now.toLocaleString("default", { month: "long" });

  return `Current date is ${year}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")} (${monthName} ${day}, ${year}).
When searching for recent information, prioritize results from the current year (${year}) and month (${monthName} ${year}).
For queries about recent developments, include the current year (${year}) in your search terms.
When ranking search results, consider recency as a factor - newer information is generally more relevant for current topics.`;
};

// Export all prompts together with date context
export const PROMPTS = {
  evaluation: EVALUATION_PROMPT,
  research: RESEARCH_PROMPT_TEMPLATE,
  reasoningSearchResults: REASONING_SEARCH_RESULTS_PROMPT,
  decisionMaking: DECISION_MAKING_PROMPT,
  initFinalReport: INIT_FINAL_REPORT_PROMPT,
  continueFinalReport: CONTINUE_FINAL_REPORT_PROMPT,
};

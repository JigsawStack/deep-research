export const generateFollowupPrompts = ({
  maxQuestions,
  searchResult,
  mainPrompt,
}: {
  maxQuestions: number;
  searchResult: {
    searchResults: {
      ai_overview: string;
      results: Array<{ content: string }>;
    };
    question: {
      question: string;
    };
  };
  mainPrompt: string[];
}) => {
  const systemPrompt = `You are an expert research assistant specializing in generating highly relevant follow-up questions. Review the information provided and generate specific follow-up questions that would deepen understanding of the main topic.

Your task is to:
1. Generate exactly ${maxQuestions} follow-up questions that build on the information provided
2. Ensure each question:
   - Explores an important aspect that needs more information
   - Is specific and answerable through web search
   - Helps deepen understanding of the main research topic
   - Focuses on filling knowledge gaps

IMPORTANT: Return ONLY a JSON array of strings with your questions. Format your response as a valid JSON array with no additional text, markdown formatting, or explanation.
Example: ["What are the environmental impacts of large language models?", "How do quantum computing advancements affect cryptography?"]`;

  const content =
    searchResult.searchResults.ai_overview ||
    searchResult.searchResults.results.map((r) => r.content).join('\n\n');

  const userPrompt = `Main Research Topic(s):
${mainPrompt.join('\n')}

Question that was researched:
${searchResult.question.question}

Information found so far:
${content}

Based on this information, what are ${maxQuestions} important follow-up questions that would help fill knowledge gaps?`;

  return {
    systemPrompt,
    userPrompt,
  };
};

export const generateSubQuestionsPrompt = ({
  mainPrompt,
  targetQuestionCount,
}: {
  mainPrompt: string[];
  targetQuestionCount: number;
}) => {
  const systemPrompt = `You are an expert research assistant specializing in generating highly relevant and focused sub-questions. Your task is to:

1. Generate exactly ${targetQuestionCount} sub-questions that are STRICTLY related to the main topic
2. Rank these questions by relevance (1.0 being most relevant, 0.0 being least relevant)
3. Ensure each question:
   - Directly connects to the main topic
   - Is specific and answerable
   - Helps deepen understanding of the core topic
   - Doesn't drift into tangential or loosely related areas
4. Return ONLY raw JSON array of objects with 'question' and 'relevanceScore' fields

TOPIC RELEVANCE GUIDELINES:
- Stay within the immediate scope of the main topic
- Avoid questions that require external context not mentioned in the main topic
- Focus on depth rather than breadth
- Ensure each question could help answer or understand the main topic

EXAMPLES:

If main topic is "Impact of AI on Healthcare":

GOOD questions (high relevance score 0.8-1.0):
- "What specific AI algorithms are currently being used in medical diagnosis?"
- "How has machine learning improved the accuracy of disease prediction?"
- "What are the primary challenges in implementing AI systems in hospitals?"

BAD questions (low relevance score 0.0-0.4):
- "How do computers work?" (too general, not focused on AI or healthcare)
- "What is the history of hospitals?" (not focused on AI)
- "Can AI be conscious?" (philosophical, not healthcare-focused)

IMPORTANT: Return ONLY the raw JSON array. Do not wrap it in code blocks or add any other text.
Example format:
[{"question": "What specific AI algorithms are currently being used in medical diagnosis?", "relevanceScore": 0.95}, {"question": "How has machine learning improved the accuracy of disease prediction?", "relevanceScore": 0.85}]`;

  const userPrompt = `Main Research Topic(s):
${mainPrompt.join('\n')}

Generate ${targetQuestionCount} ranked sub-questions that will help explore this topic deeply.`;

  return {
    systemPrompt,
    userPrompt,
  };
};

export const checkRelevancePrompt = ({
  question,
  mainPrompt,
}: {
  question: string;
  mainPrompt: string[];
}) => {
  const systemPrompt = `You are an expert research assistant. Your task is to check if the question is relevant to the main research topic or not.
    Return only a boolean value (true or false)`;

  const userPrompt = `Main Research Topic(s):
${mainPrompt.join('\n')}

Question: ${question}`;

  return {
    systemPrompt,
    userPrompt,
  };
};

import {
  SubQuestion,
  SubQuestionGeneratorConfig,
  SubQuestionGeneratorResult,
} from '../types/generators';
import { ResearchBreadthConfig } from '../types';
import { OpenAIProvider } from '../provider/openai';
import 'dotenv/config';
import { GeminiProvider } from '../provider/gemini';
export class SubQuestionGenerator {
  private openaiInstance: OpenAIProvider;
  private geminiInstance: GeminiProvider;
  constructor() {
    // if(!process.env.OPENAI_API_KEY) {
    //   throw new Error('OPENAI_API_KEY is not set');
    // }
    this.openaiInstance = OpenAIProvider.getInstance({
      apiKey: process.env.OPENAI_API_KEY || '',
    });
    this.geminiInstance = GeminiProvider.getInstance({
      apiKey: process.env.GEMINI_API_KEY || '',
    });
  }

  async generateSubQuestions(
    mainPrompt: string[],
    breadthConfig: ResearchBreadthConfig
  ): Promise<any> {
    const targetQuestionCount = breadthConfig.maxParallelTopics + 2;

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

    try {
      const combinedPrompt = `${systemPrompt}\n\n${userPrompt}`;
      const response = await this.openaiInstance.generateText(
        combinedPrompt,
        'gpt-4o'
      );

      let parsedQuestions;
      try {
        parsedQuestions = JSON.parse(response);
      } catch (parseError) {
        throw new Error(`Failed to parse response as JSON: ${parseError}`);
      }

      // pick the questions equal to the breadthConfig.maxParallelTopics
      let questions: SubQuestion[] = parsedQuestions.slice(
        0,
        breadthConfig.maxParallelTopics
      );

      questions = await this.validateResponse(questions, mainPrompt);

      return {
        questions,
        metadata: {
          totalGenerated: questions.length,
          averageRelevanceScore:
            questions.reduce((acc, q) => acc + q.relevanceScore, 0) /
            questions.length,
          generationTimestamp: new Date().toISOString(),
        },
      };
    } catch (error: unknown) {
      throw new Error(
        `Failed to generate sub-questions: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  public async checkRelevance(
    question: string,
    mainPrompt: string[]
  ): Promise<boolean> {
    const systemPrompt = `You are an expect research assistant. Your task it to check if the question is relevant to the main research topic or not.
    Return only a boolean value (true or false)`;

    const userPrompt = `Main Research Topic(s):
${mainPrompt.join('\n')}

Question: ${question}`;

    const combinedPrompt = `${systemPrompt}\n\n${userPrompt}`;
    const response = await this.geminiInstance.generateText(
      combinedPrompt,
      'gemini-1.5-flash'
    );

    // Normalize the response to handle different formats
    const normalizedResponse = response.trim().toLowerCase();
    console.log(
      `Question: ${question} is relevant: ${response} (normalized: ${normalizedResponse})`
    );

    // Check if it contains "true" anywhere in the response
    return normalizedResponse.includes('true');
  }

  private async validateResponse(
    questions: SubQuestion[],
    mainPrompt: string[]
  ): Promise<SubQuestion[]> {
    if (!Array.isArray(questions)) {
      throw new Error(
        'Invalid response format: expected an array of questions'
      );
    }

    console.log('Before validation, questions:', JSON.stringify(questions));

    const validatedQuestions = [...questions]; // Create a copy to avoid modifying during iteration

    // Using Promise.all for proper handling of asynchronous operations
    const relevanceChecks = await Promise.all(
      validatedQuestions.map(async (q, idx) => {
        console.log(
          `Checking question ${idx}:`,
          q.question,
          'relevanceScore:',
          q.relevanceScore
        );

        if (!q.question || typeof q.relevanceScore !== 'number') {
          console.log(`Question ${idx} invalid format`);
          q.relevanceScore = 0;
          return false;
        }
        if (q.relevanceScore < 0 || q.relevanceScore > 1) {
          console.log(`Question ${idx} invalid score range:`, q.relevanceScore);
          q.relevanceScore = 0;
          return false;
        }

        // Check if the question is relevant to the main research topic
        const isRelevant = await this.checkRelevance(q.question, mainPrompt);
        console.log(`Question ${idx} relevance check result:`, isRelevant);
        return isRelevant;
      })
    );

    console.log('Relevance checks results:', relevanceChecks);

    // Filter out irrelevant questions
    const result = validatedQuestions.filter((q, index) => {
      const shouldKeep = relevanceChecks[index] && q.relevanceScore > 0;
      console.log(
        `Question ${index} should keep:`,
        shouldKeep,
        'relevanceCheck:',
        relevanceChecks[index],
        'score:',
        q.relevanceScore
      );
      return shouldKeep;
    });

    console.log('After validation, questions:', JSON.stringify(result));
    return result;
  }
}

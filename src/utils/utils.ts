export function cleanJsonResponse(response: string): string {
  // Check if this is a markdown article with JSON metadata at the end
  const jsonBlockMatch = response.match(/```json\s*([\s\S]*?)\s*```/);
  if (jsonBlockMatch) {
    console.log('Found JSON metadata block in markdown article');
    try {
      // Extract and parse the JSON block
      const jsonContent = jsonBlockMatch[1].trim();
      // Test if it's valid JSON
      JSON.parse(jsonContent);
      return jsonContent;
    } catch (e) {
      console.error('Failed to parse JSON metadata block:', e);
    }
  }

  // Remove markdown code block markers if present
  let cleaned = response
    .replace(/```(json|javascript)?\s*/g, '')
    .replace(/\s*```\s*$/g, '');

  // Trim whitespace
  cleaned = cleaned.trim();

  // Try to find a valid JSON object in the text
  try {
    // If the response starts with a bracket or curly brace, assume it's JSON
    if (
      (cleaned.startsWith('{') && cleaned.endsWith('}')) ||
      (cleaned.startsWith('[') && cleaned.endsWith(']'))
    ) {
      // Test if it's valid JSON
      JSON.parse(cleaned);
      return cleaned;
    }

    // Try to extract JSON object from text
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const potentialJson = jsonMatch[0];
      // Test if it's valid JSON
      JSON.parse(potentialJson);
      return potentialJson;
    }
  } catch (e) {
    // If parsing fails, try to fix common issues with JSON strings
    console.log('JSON parsing failed, attempting to fix common issues...');

    // Handle escaped dollar signs in strings that might be causing issues
    const fixedJson = cleaned.replace(/(\\"|\s|\n|\r)(\$)(\d)/g, '$1\\\\$2$3');

    try {
      JSON.parse(fixedJson);
      return fixedJson;
    } catch (e2) {
      console.error('Failed to fix JSON:', e2);

      // If all attempts fail, create a minimal valid JSON with the content as analysis
      try {
        // Create a minimal JSON object with the content as analysis
        const minimalJson = JSON.stringify({
          analysis: response.substring(0, 2000), // Limit to 2000 chars to avoid token issues
          keyThemes: ['Content extraction failed'],
          insights: ['Unable to parse response as JSON'],
          knowledgeGaps: ['Full content available in raw response'],
          confidence: 0.5,
          relatedQuestions: [],
        });

        return minimalJson;
      } catch (e3) {
        console.error('Failed to create minimal JSON:', e3);
      }
    }
  }

  // If we can't find a JSON object, return the cleaned string
  return cleaned;
}

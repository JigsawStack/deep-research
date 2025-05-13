export function cleanJsonResponse(response: string): string {
  // Remove markdown code block markers if present
  let cleaned = response
    .replace(/```(json|javascript)?\s*/g, '')
    .replace(/\s*```\s*$/g, '');

  // Trim whitespace
  cleaned = cleaned.trim();

  // If the response starts with a bracket or curly brace, assume it's JSON
  if (
    (cleaned.startsWith('{') && cleaned.endsWith('}')) ||
    (cleaned.startsWith('[') && cleaned.endsWith(']'))
  ) {
    return cleaned;
  }

  // Try to extract JSON object from text
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    return jsonMatch[0];
  }

  // If we can't find a JSON object, return the cleaned string
  return cleaned;
}

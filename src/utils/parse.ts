/**
 * Safely parse JSON from LLM responses.
 * Handles common LLM output issues:
 * - Markdown code fences (```json ... ```)
 * - Leading/trailing whitespace
 * - Trailing commas
 * - Returns a default value on failure instead of throwing
 */
export function safeParseLLMJson<T>(
  text: string,
  defaultValue: T,
  label: string = "LLM"
): T {
  try {
    // Strip markdown code fences if present
    let cleaned = text.trim();

    // Remove ```json ... ``` or ``` ... ``` wrapping
    const fenceMatch = cleaned.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/);
    if (fenceMatch) {
      cleaned = fenceMatch[1].trim();
    }

    // Remove trailing commas before } or ]
    cleaned = cleaned.replace(/,\s*([}\]])/g, "$1");

    const parsed = JSON.parse(cleaned);
    return parsed as T;
  } catch (err) {
    console.error(
      `[${label}] Failed to parse JSON response. ` +
      `Error: ${err instanceof Error ? err.message : String(err)}. ` +
      `Raw text (first 200 chars): "${text.slice(0, 200)}"`
    );
    return defaultValue;
  }
}

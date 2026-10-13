import { GoogleGenAI } from '@google/genai';

const PROMPT = `You extract factual claims from a witness or police statement. Return ONLY JSON: {"claims":[{"type":"presence|object|event","person":string|null,"place":string|null,"date":string|null,"startTime":"HH:MM"|null,"endTime":"HH:MM"|null,"description":string,"quote":string}]}
Rules:
- Only include what the text explicitly says. Never infer or guess.
- type=presence: a named person seen or located at a place. type=object: a vehicle, item or thing observed. type=event: anything else that happened.
- If the author names themselves, resolve 'I' to that full name.
- Times in 24-hour HH:MM. 'around 9 PM' = 21:00. A stay 'until 9:30 PM' sets endTime 21:30. Use null if unknown.
- date exactly as written (e.g. '12 October') or null.
- quote must be copied word-for-word from the text.
- If there are no claims, return {"claims":[]}.`;

// It tries each model 3 times with growing waits (2s, 4s, 6s), 
// then falls back to flash-lite, which usually has spare capacity

const MODELS = [...new Set([
  process.env.GEMINI_MODEL,
  'gemini-3.5-flash-lite',
  'gemini-2.5-flash',
].filter(Boolean))];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function extractClaims(text) {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  let lastErr;
  for (const model of MODELS) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const r = await ai.models.generateContent({
          model,
          contents: PROMPT + '\n\nSTATEMENT:\n' + text.slice(0, 30000),
          config: { responseMimeType: 'application/json', temperature: 0 },
        });
        console.log('GEMINI OK:', model);
        const j = JSON.parse(r.text);
        return Array.isArray(j.claims) ? j.claims : [];
        } catch (e) {
        lastErr = e;
        const msg = String(e.message);
        console.log(`${model} attempt ${attempt} failed:`, msg.slice(0, 80));
        if (!(msg.includes('503') || msg.includes('UNAVAILABLE'))) break; // 404/429: next model now
        await sleep(attempt * 2000);
        }
    }
  }
  throw lastErr;
}
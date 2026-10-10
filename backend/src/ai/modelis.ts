/**
 * Vienintelė vieta, kur kalbama su AI tiekėju (Anthropic Messages API, paprastas fetch).
 * Pakeitus tiekėją, keičiamas tik šis failas.
 */

export const MODEL = "claude-haiku-5-5";

/** Kainos JAV doleriais už milijoną žetonų (Claude Haiku 5.5, 2026-10). */
const PRICE = { input: 0.1, output: 0.5, cacheWrite: 0.125, cacheRead: 0.01 };

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string };

export interface Message {
  role: "user" | "assistant";
  content: ContentBlock[];
}

export interface Tool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface ModelRequest {
  /** Nekintanti dalis (instrukcijos) — kešuojama. */
  instructions: string;
  /** Kintanti dalis: data, kalendorius, užduotys. */
  context: string;
  tools: Tool[];
  messages: Message[];
}

export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

export interface ModelResponse {
  content: ContentBlock[];
  usage: Usage;
  model: string;
  /** „max_tokens“ — atsakymas nutrūko (pvz., per didelis projekto planas). */
  stop_reason?: string;
}

export type ModelCaller = (request: ModelRequest) => Promise<ModelResponse>;

/** Klaida, kurią galima parodyti žmogui (tiekėjas neatsako, baigėsi pinigai ir pan.). */
export class ModelioKlaida extends Error {}

export function costUsd(usage: Usage): number {
  return (
    (usage.input_tokens * PRICE.input +
      usage.output_tokens * PRICE.output +
      (usage.cache_creation_input_tokens ?? 0) * PRICE.cacheWrite +
      (usage.cache_read_input_tokens ?? 0) * PRICE.cacheRead) /
    1_000_000
  );
}

function explain(status: number, body: string): string {
  if (status === 401) return "Neteisingas Anthropic raktas — patikrink ANTHROPIC_API_KEY.";
  if (status === 400 && /credit balance/i.test(body)) return "Anthropic sąskaitoje baigėsi pinigai — papildyk console.anthropic.com.";
  if (status === 429) return "Per daug užklausų iš eilės — pabandyk po minutės.";
  if (status === 529 || status >= 500) return "Asistentas šiuo metu perkrautas — pabandyk po minutės.";
  return `Asistentas neatsakė (${status}).`;
}

/** Tikras kreipinys į Anthropic. */
export function anthropicCaller(apiKey: string): ModelCaller {
  return async (request) => {
    let res: Response;
    try {
      res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: MODEL,
          // Didelis projektas (etapai, darbai, biudžetas) gali užimti kelis tūkstančius žetonų;
          // mokama tik už tiek, kiek iš tikrųjų sugeneruota.
          max_tokens: 8000,
          system: [
            { type: "text", text: request.instructions, cache_control: { type: "ephemeral" } },
            { type: "text", text: request.context },
          ],
          tools: request.tools,
          messages: request.messages,
        }),
      });
    } catch (error) {
      throw new ModelioKlaida(`Nepavyko susisiekti su asistentu: ${error instanceof Error ? error.message : error}`);
    }
    const body = await res.text();
    if (!res.ok) {
      console.error("Anthropic", res.status, body.slice(0, 500));
      throw new ModelioKlaida(explain(res.status, body));
    }
    const data = JSON.parse(body) as ModelResponse;
    if (data.stop_reason === "max_tokens") {
      console.error("Anthropic: atsakymas nutrūko (max_tokens)");
      throw new ModelioKlaida("Atsakymas per ilgas ir nutrūko — pabandyk paprašyti mažesnėmis dalimis.");
    }
    return { content: data.content.filter((b) => b.type === "text" || b.type === "tool_use"), usage: data.usage, model: data.model };
  };
}

// Serverless calorie estimator for the tracker in /fit.
// Deploy this repo on Vercel and set these Environment Variables:
//   ANTHROPIC_API_KEY  (required)  your Claude API key — stays on the server, never in the page
//   APP_PASSCODE       (recommended) any secret word; type the same word in the app's Settings
//   ALLOWED_ORIGIN     (optional)  e.g. https://vfc-1.github.io  (defaults to *)
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic(); // reads ANTHROPIC_API_KEY from the environment

const FOOD_SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          portion: { type: "string" },
          calories: { type: "integer" },
        },
        required: ["name", "portion", "calories"],
        additionalProperties: false,
      },
    },
    total_calories: { type: "integer" },
    protein_g: { type: "integer" },
    confidence: { type: "string", enum: ["low", "medium", "high"] },
    title: { type: "string" },
    note: { type: "string" },
  },
  required: ["items", "total_calories", "protein_g", "confidence", "title", "note"],
  additionalProperties: false,
};

const EXERCISE_SCHEMA = {
  type: "object",
  properties: {
    calories: { type: "integer" },
    title: { type: "string" },
    note: { type: "string" },
  },
  required: ["calories", "title", "note"],
  additionalProperties: false,
};

// Reading a workout-summary screenshot (Peloton, Apple Fitness, a gym machine, ...).
// Numbers not shown on screen come back as 0 / "" and the app fills in the rest.
const WORKOUT_SHOT_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    discipline: { type: "string" },
    minutes: { type: "number" },
    miles: { type: "number" },
    calories: { type: "integer" },
    avg_hr: { type: "integer" },
    incline: { type: "number" },
    speed: { type: "number" },
    output_kj: { type: "integer" },
    when: { type: "string" },
    note: { type: "string" },
  },
  required: ["title", "discipline", "minutes", "miles", "calories", "avg_hr", "incline", "speed", "output_kj", "when", "note"],
  additionalProperties: false,
};

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOWED_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-App-Code");
  res.setHeader("Access-Control-Max-Age", "86400");
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const passcode = process.env.APP_PASSCODE;
  if (passcode && req.headers["x-app-code"] !== passcode) {
    return res.status(401).json({ error: "Wrong passcode. Check Me → AI estimates → Passcode." });
  }

  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  const kind = body.kind === "exercise" ? "exercise" : "food";
  const text = String(body.text || "").slice(0, 1000);
  const weightLbs = Number(body.weightLbs) || null;

  const content = [];
  if (body.image && typeof body.image === "string") {
    const m = body.image.match(/^data:(image\/(?:jpeg|png|webp|gif));base64,(.+)$/);
    if (!m) return res.status(400).json({ error: "Image must be a base64 data URL" });
    content.push({ type: "image", source: { type: "base64", media_type: m[1], data: m[2] } });
  }
  if (!text && content.length === 0) return res.status(400).json({ error: "Nothing to estimate" });

  const workoutShot = kind === "exercise" && content.length > 0;
  const prompt = workoutShot
    ? `This is a screenshot of a workout summary (for example from the Peloton app). Read the numbers exactly as shown.
"title": the class or workout name. "discipline": e.g. Running, Walking, Cycling, Strength, Yoga, Rowing.
"minutes": duration in minutes (40:38 → 40.6). "miles": distance in miles. "calories": the calories shown.
"avg_hr": average heart rate if shown. "incline": average incline percent. "speed": average speed in mph. "output_kj": total output in kJ.
"when": the date and time shown, as YYYY-MM-DD HH:MM in 24-hour time (two-digit years like 11/20/26 mean 2026).
Use 0 for any number that isn't on screen and "" for text that isn't. "note": one short encouraging sentence.`
    : kind === "food"
      ? `Estimate the calories in this meal for a weight-loss food log.
${text ? `The person describes it as: "${text}"` : "No description was given; rely on the photo."}
${content.length ? "Use the photo to judge portion sizes (plate size, utensils, packaging)." : ""}
List each distinct food with a realistic portion and its calories, then the total.
Assume typical restaurant/home portions when unsure, and include oils, sauces and drinks you can see or that are implied.
"title" is a short 2-5 word name for the meal. "note" is one short, friendly sentence (a tip or what you assumed).`
      : `Estimate calories burned for this activity for a fitness log: "${text}".
${weightLbs ? `The person weighs about ${weightLbs} lbs.` : "Assume the person weighs about 190 lbs."}
Use standard MET values. If no duration is given, assume 30 minutes. Count only calories above resting.
"title" is a short name for the activity with its duration. "note" is one short encouraging sentence.`;
  content.push({ type: "text", text: prompt });

  try {
    const response = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: {
        effort: "low",
        format: { type: "json_schema", schema: kind === "food" ? FOOD_SCHEMA : workoutShot ? WORKOUT_SHOT_SCHEMA : EXERCISE_SCHEMA },
      },
      messages: [{ role: "user", content }],
    });

    if (response.stop_reason === "refusal") {
      return res.status(422).json({ error: "Couldn't estimate that one. Try describing it in words." });
    }
    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock) return res.status(502).json({ error: "No estimate returned" });
    return res.status(200).json({ kind, ...JSON.parse(textBlock.text) });
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) {
      return res.status(500).json({ error: "Server API key is invalid. Check ANTHROPIC_API_KEY on Vercel." });
    } else if (error instanceof Anthropic.RateLimitError) {
      return res.status(429).json({ error: "Too many requests — try again in a minute." });
    } else if (error instanceof Anthropic.BadRequestError) {
      return res.status(400).json({ error: `Request rejected: ${error.message}` });
    } else if (error instanceof Anthropic.APIError) {
      return res.status(502).json({ error: `AI service error (${error.status}). Try again.` });
    } else if (error instanceof SyntaxError) {
      return res.status(502).json({ error: "AI returned an unreadable estimate. Try again." });
    }
    console.error(error);
    return res.status(500).json({ error: "Unexpected server error" });
  }
}

// Photos are resized in the browser to ~1024px, well under Vercel's 4.5 MB body limit.
export const config = { api: { bodyParser: { sizeLimit: "4mb" } } };

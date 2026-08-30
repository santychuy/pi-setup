import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_PATH = path.join(__dirname, "..", "..", "skills", "caveman", "SKILL.md");

function loadInstructions() {
  const raw = fs.readFileSync(SKILL_PATH, "utf8");
  return raw.replace(/^---[\s\S]*?---\s*/, "").trim();
}

const INSTRUCTIONS = loadInstructions();

export default function cavemanExtension(pi) {
  pi.on("session_start", async (_event, ctx) => {
    ctx?.ui?.setStatus?.("caveman", "⛏ caveman");
  });

  pi.on("before_agent_start", async (event) => {
    const base = event?.systemPrompt ? `${event.systemPrompt}\n\n` : "";
    return {
      systemPrompt: `${base}# Caveman (always on)\n\n${INSTRUCTIONS}`,
    };
  });
}

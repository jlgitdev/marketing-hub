import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";

const projectRoot = path.resolve(import.meta.dirname, "..");
const agenda = JSON.parse(fs.readFileSync(path.join(projectRoot, "src", "data", "summit-agenda.json"), "utf8"));
const folders = { day1: "day 1", day2: "day 2" };
const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();

function fail(message) { throw new Error(`Agenda verification failed: ${message}`); }

for (const day of agenda.days) {
  const htmlPath = path.join(projectRoot, "summit agenda creation", folders[day.key], "AGI Summit · Agenda Planner.html");
  const html = fs.readFileSync(htmlPath, "utf8");
  const digest = crypto.createHash("sha256").update(html).digest("hex");
  if (digest !== day.sourceSha256) fail(`${day.label} source SHA-256 changed.`);
  const document = new JSDOM(html).window.document;
  const cards = [...document.querySelectorAll("#stages .sess")];
  if (cards.length !== day.sessions.length) fail(`${day.label} has ${cards.length} source cards but ${day.sessions.length} extracted sessions.`);
  const remaining = new Set(day.sessions.map((session) => session.id));

  for (const card of cards) {
    const handler = card.querySelector(".srel")?.getAttribute("onchange") || "";
    const identity = handler.match(/setSessRelation\('([^']+)','([^']+)'/);
    if (!identity) fail(`${day.label} contains a card without a stable identity.`);
    const id = `${day.key}-${identity[1]}-${identity[2]}`;
    const session = day.sessions.find((item) => item.id === id);
    if (!session) fail(`${day.label} source card ${id} is missing from extracted data.`);
    remaining.delete(id);
    const [startLabel, endLabel] = clean(card.querySelector(".stime")?.textContent).split(/\s+-\s+/);
    const sourcePeople = [...card.querySelectorAll(".chip")].map((chip) => {
      const clone = chip.cloneNode(true);
      clone.querySelectorAll(".modtag,.av,xx").forEach((node) => node.remove());
      return { name: clean(clone.textContent), moderator: chip.classList.contains("mod") };
    });
    const comparisons = [
      ["start", session.startLabel, startLabel],
      ["end", session.endLabel, endLabel],
      ["format", session.format, clean(card.querySelector(".fmtpill")?.textContent)],
      ["title", session.title, clean(card.querySelector(".topic")?.textContent)],
      ["people", JSON.stringify(session.people.map(({ name, moderator }) => ({ name, moderator }))), JSON.stringify(sourcePeople)]
    ];
    for (const [field, extracted, source] of comparisons) if (extracted !== source) fail(`${id} ${field} differs: ${JSON.stringify(extracted)} !== ${JSON.stringify(source)}.`);
    for (const person of session.people) {
      if (!person.photo) continue;
      const [scope, fileName] = person.photo.split(":", 2);
      if (scope !== "default" || !fs.existsSync(path.join(projectRoot, "public", "summit-agenda", "portraits", fileName))) fail(`${id} portrait for ${person.name} is not backed by a copied source asset.`);
    }
  }
  if (remaining.size) fail(`${day.label} contains extracted sessions not present in the source DOM: ${[...remaining].join(", ")}.`);
  console.log(`${day.label}: ${day.sessions.length} sessions verified against ${path.relative(projectRoot, htmlPath)}.`);
}

console.log("All agenda titles, formats, times, people, moderator flags, portraits, counts, and source hashes match.");

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = path.join(projectRoot, "summit agenda creation");
const outputDataPath = path.join(projectRoot, "src", "data", "summit-agenda.json");
const portraitOutput = path.join(projectRoot, "public", "summit-agenda", "portraits");
const referenceOutput = path.join(projectRoot, "public", "summit-agenda", "references");

const sources = [
  { key: "day1", folder: "day 1", label: "Day 1", date: "July 18, 2026" },
  { key: "day2", folder: "day 2", label: "Day 2", date: "July 19, 2026" }
];

const stageNames = {
  gpt: "AGI Stage",
  agi: "Applied AI Stage",
  pitch: "Discovery Stage",
  workshop: "Workshop"
};

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function selectedValue(element) {
  return element?.querySelector("option[selected]")?.getAttribute("value") || element?.value || null;
}

function personIdFromChip(chip) {
  const handler = chip.querySelector("xx")?.getAttribute("onclick") || "";
  return handler.match(/rmSpeaker\('[^']+','[^']+','([^']+)'\)/)?.[1] || null;
}

function sessionIdentity(card) {
  const handler = card.querySelector(".srel")?.getAttribute("onchange") || "";
  const match = handler.match(/setSessRelation\('([^']+)','([^']+)'/);
  if (!match) throw new Error(`Could not extract a session identity for ${cleanText(card.textContent).slice(0, 100)}`);
  return { stage: match[1], sourceId: match[2] };
}

function timeToMinutes(value) {
  const match = cleanText(value).match(/^(\d{1,2}):(\d{2})$/);
  if (!match) throw new Error(`Invalid agenda time: ${value}`);
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour >= 1 && hour < 8) hour += 12;
  return hour * 60 + minute;
}

function findRosterPeople(document) {
  const people = new Map();
  for (const card of document.querySelectorAll("#rosterList .scard")) {
    const handler = card.querySelector(".pickbtn")?.getAttribute("onclick") || card.querySelector(".st")?.getAttribute("onchange") || "";
    const id = handler.match(/(?:pickSpeaker|setStatus)\('([^']+)'/)?.[1];
    if (!id) continue;
    const nameNode = card.querySelector(".nm")?.cloneNode(true);
    nameNode?.querySelectorAll(".dot,.offsite").forEach((node) => node.remove());
    const photo = card.querySelector(".av img")?.getAttribute("src") || null;
    people.set(id, {
      id,
      name: cleanText(nameNode?.textContent),
      role: cleanText(card.querySelector(".ti")?.textContent),
      company: cleanText(card.querySelector(".co")?.textContent),
      photo
    });
  }
  return people;
}

function fileNameFromSource(value) {
  if (!value) return null;
  const decoded = decodeURIComponent(value);
  return path.basename(decoded);
}

function choosePortrait(sourceDirectory, chipSource, rosterSource) {
  const candidates = [rosterSource, chipSource].map(fileNameFromSource).filter(Boolean);
  for (const original of candidates) {
    for (const candidate of [original.replace(/_tm5f(?=\.)/, "_500L"), original]) {
      if (fs.existsSync(path.join(sourceDirectory, candidate))) return candidate;
    }
  }
  return null;
}

function copyPortrait(sourceDirectory, fileName) {
  if (!fileName) return null;
  const sourcePath = path.join(sourceDirectory, fileName);
  const destinationPath = path.join(portraitOutput, fileName);
  if (!fs.existsSync(destinationPath)) fs.copyFileSync(sourcePath, destinationPath);
  else if (!fs.readFileSync(sourcePath).equals(fs.readFileSync(destinationPath))) throw new Error(`Portrait filename collision: ${fileName}`);
  return `default:${fileName}`;
}

function parseDay(source) {
  const htmlPath = path.join(sourceRoot, source.folder, "AGI Summit · Agenda Planner.html");
  const html = fs.readFileSync(htmlPath, "utf8");
  const document = new JSDOM(html).window.document;
  const sourceDirectory = path.join(sourceRoot, source.folder, "AGI Summit · Agenda Planner_files");
  const roster = findRosterPeople(document);
  const sessions = [];

  for (const card of document.querySelectorAll("#stages .sess")) {
    const { stage, sourceId } = sessionIdentity(card);
    if (!stageNames[stage]) throw new Error(`Unknown agenda stage: ${stage}`);
    const [startLabel, endLabel] = cleanText(card.querySelector(".stime")?.textContent).split(/\s+-\s+/);
    if (!startLabel || !endLabel) throw new Error(`Missing time range for ${source.key}/${stage}/${sourceId}`);
    const people = [...card.querySelectorAll(".chip")].map((chip, index) => {
      const chipCopy = chip.cloneNode(true);
      chipCopy.querySelectorAll(".modtag,.av,xx").forEach((node) => node.remove());
      const id = personIdFromChip(chip) || `${source.key}-${stage}-${sourceId}-person-${index + 1}`;
      const rosterPerson = roster.get(id);
      const name = cleanText(chipCopy.textContent) || rosterPerson?.name || "Unnamed person";
      const portraitFile = choosePortrait(sourceDirectory, chip.querySelector("img")?.getAttribute("src") || null, rosterPerson?.photo || null);
      return {
        id,
        name,
        role: rosterPerson?.role || "",
        company: rosterPerson?.company || "",
        moderator: chip.classList.contains("mod"),
        photo: copyPortrait(sourceDirectory, portraitFile)
      };
    });
    const sessionStatus = selectedValue(card.querySelector('.sstatus[title*="Session status"]'));
    sessions.push({
      id: `${source.key}-${stage}-${sourceId}`,
      sourceId,
      day: source.key,
      stage,
      stageName: stageNames[stage],
      start: timeToMinutes(startLabel),
      end: timeToMinutes(endLabel),
      startLabel,
      endLabel,
      format: cleanText(card.querySelector(".fmtpill")?.textContent) || "Talk",
      title: cleanText(card.querySelector(".topic")?.textContent),
      status: sessionStatus || "talking",
      relation: selectedValue(card.querySelector(".srel")) || "invited",
      notified: selectedValue(card.querySelector(".snot")) === "yes",
      people
    });
  }

  const duplicateIds = sessions.filter((session, index) => sessions.findIndex((other) => other.id === session.id) !== index);
  if (duplicateIds.length) throw new Error(`Duplicate session ids in ${source.folder}: ${duplicateIds.map((item) => item.id).join(", ")}`);
  return {
    key: source.key,
    label: source.label,
    date: source.date,
    sourceFile: path.relative(projectRoot, htmlPath),
    sourceSha256: crypto.createHash("sha256").update(html).digest("hex"),
    sessions: sessions.sort((a, b) => a.start - b.start || Object.keys(stageNames).indexOf(a.stage) - Object.keys(stageNames).indexOf(b.stage))
  };
}

fs.mkdirSync(path.dirname(outputDataPath), { recursive: true });
fs.mkdirSync(portraitOutput, { recursive: true });
fs.mkdirSync(referenceOutput, { recursive: true });

const referenceFiles = [
  ["one person image.png", "one-person.png"],
  ["two person image.png", "two-person.png"],
  ["5 person image.png", "five-person.png"]
];
for (const [sourceName, outputName] of referenceFiles) {
  fs.copyFileSync(path.join(sourceRoot, "example images", sourceName), path.join(referenceOutput, outputName));
}

const days = sources.map(parseDay);
const payload = {
  event: { name: "AGI Summit SF 2026", location: "San Francisco", timezone: "America/Los_Angeles" },
  stages: Object.entries(stageNames).map(([key, name]) => ({ key, name })),
  references: {
    one: "summit-agenda/references/one-person.png",
    two: "summit-agenda/references/two-person.png",
    many: "summit-agenda/references/five-person.png"
  },
  days
};

fs.writeFileSync(outputDataPath, `${JSON.stringify(payload, null, 2)}\n`);
console.log(`Extracted ${days.map((day) => `${day.label}: ${day.sessions.length} sessions`).join(", ")}.`);
console.log(`Copied ${new Set(days.flatMap((day) => day.sessions.flatMap((session) => session.people.map((person) => person.photo).filter(Boolean)))).size} unique portraits.`);

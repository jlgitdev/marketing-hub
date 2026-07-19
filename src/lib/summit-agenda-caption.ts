import type { SummitAgendaSession } from "@/lib/types";

const CLOCKS = {
  hour: ["🕛", "🕐", "🕑", "🕒", "🕓", "🕔", "🕕", "🕖", "🕗", "🕘", "🕙", "🕚"],
  half: ["🕧", "🕜", "🕝", "🕞", "🕟", "🕠", "🕡", "🕢", "🕣", "🕤", "🕥", "🕦"]
} as const;

const LOWERCASE_TITLE_WORDS = new Set([
  "a", "an", "and", "as", "at", "but", "by", "for", "from", "in", "into", "nor", "of", "on", "or", "over", "per", "the", "to", "via", "vs", "with", "without", "yet"
]);

const TOPIC_HASHTAGS: Array<{ pattern: RegExp; hashtag: string }> = [
  { pattern: /\b(?:ai\s+)?agents?\b/i, hashtag: "#AIAgents" },
  { pattern: /\bautonomous\b/i, hashtag: "#AutonomousAI" },
  { pattern: /\b(?:developer|dev)\s+tools?\b/i, hashtag: "#DeveloperTools" },
  { pattern: /\bengineer(?:ing|s)?\b/i, hashtag: "#Engineering" },
  { pattern: /\b(?:pull requests?|prs?|software development|coding|code generation)\b/i, hashtag: "#SoftwareDevelopment" },
  { pattern: /\brobot(?:ics|s)?\b/i, hashtag: "#Robotics" },
  { pattern: /\b(?:health(?:care)?|medical|medicine)\b/i, hashtag: "#HealthAI" },
  { pattern: /\b(?:cybersecurity|security|privacy)\b/i, hashtag: "#Cybersecurity" },
  { pattern: /\b(?:inference|gpu|compute|data ?centers?|infrastructure)\b/i, hashtag: "#AIInfrastructure" },
  { pattern: /\b(?:large language models?|llms?|foundation models?)\b/i, hashtag: "#LLM" },
  { pattern: /\b(?:voice|speech|audio)\b/i, hashtag: "#VoiceAI" },
  { pattern: /\b(?:startup|founder|venture capital|investment)\b/i, hashtag: "#AIStartups" }
];

export interface SummitAgendaCaptionEvent {
  name?: string;
  location?: string;
}

/** Builds the live-agenda caption entirely from the frozen session record. */
export function buildSummitAgendaCaption(
  session: SummitAgendaSession,
  event: SummitAgendaCaptionEvent = {}
) {
  const eventName = shortEventName(event.name);
  const location = cleanInlineText(event.location) || "San Francisco";
  const title = formatCaptionTitle(session.title);
  const moderators = uniqueNames(session.people.filter((person) => person.moderator).map((person) => person.name));
  const moderatorNames = new Set(moderators.map((name) => name.toLocaleLowerCase("en-US")));
  const speakers = uniqueNames(session.people.filter((person) => !person.moderator).map((person) => person.name))
    .filter((name) => !moderatorNames.has(name.toLocaleLowerCase("en-US")));
  const allPeople = uniqueNames(session.people.map((person) => person.name));
  const panelStyle = session.format.trim().toLowerCase() === "panel" || moderators.length > 0;

  const lines = [
    panelStyle ? `🔴 Coming up live at ${eventName} in ${location}!` : `🔴 LIVE at ${eventName}`,
    "",
    `“${title || "Session title to be announced"}”`,
    ""
  ];

  if (moderators.length) {
    lines.push(`🎙️ Moderator${moderators.length === 1 ? "" : "s"}: ${joinNames(moderators)}`);
    if (speakers.length) lines.push(`💬 ${joinNames(speakers)}`);
  } else if (allPeople.length === 1) {
    lines.push(`🎤 ${allPeople[0]}`);
  } else if (allPeople.length > 1) {
    lines.push(`🔥 ${joinNames(allPeople)}`);
  }

  lines.push(`${clockEmoji(session.start)} ${formatTimeRange(session.start, session.end)}`);
  if (!panelStyle) lines.push(`📍 ${location}`);
  lines.push("", buildHashtags(title, allPeople.length));
  return lines.join("\n");
}

function shortEventName(name?: string) {
  const cleaned = cleanInlineText(name) || "AGI Summit";
  return cleaned.replace(/\s+SF\s+20\d{2}$/i, "").replace(/\s+20\d{2}$/i, "").trim() || "AGI Summit";
}

function cleanInlineText(value?: string) {
  return (value || "").replace(/\s+/g, " ").trim();
}

function uniqueNames(names: string[]) {
  const seen = new Set<string>();
  return names.map(cleanInlineText).filter((name) => {
    const key = name.toLocaleLowerCase("en-US");
    if (!name || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function joinNames(names: string[]) {
  if (names.length < 2) return names[0] || "";
  if (names.length === 2) return `${names[0]} & ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} & ${names.at(-1)}`;
}

function formatCaptionTitle(value: string) {
  const cleaned = cleanInlineText(value).replace(/\s*[—–]\s*/g, "—");
  return cleaned.split("—").map(titleCaseSegment).join("—");
}

function titleCaseSegment(value: string) {
  const words = value.split(" ");
  return words.map((word, index) => word.split("-").map((part, partIndex, parts) => {
    const match = part.match(/^([^\p{L}\p{N}]*)([\p{L}\p{N}][\p{L}\p{N}'’]*)(.*)$/u);
    if (!match) return part;
    const [, prefix, core, suffix] = match;
    const lower = core.toLocaleLowerCase("en-US");
    const isBoundary = (index === 0 && partIndex === 0) || (index === words.length - 1 && partIndex === parts.length - 1);
    const uppercaseLetters = [...core].filter((character) => /[A-Z]/.test(character)).length;
    const normalized = uppercaseLetters >= 2
      ? core
      : !isBoundary && LOWERCASE_TITLE_WORDS.has(lower)
        ? lower
        : `${lower.charAt(0).toLocaleUpperCase("en-US")}${lower.slice(1)}`;
    return `${prefix}${normalized}${suffix}`;
  }).join("-")).join(" ");
}

function clockEmoji(start: number) {
  const normalized = normalizeMinutes(start);
  const minute = normalized % 60;
  let hour = Math.floor(normalized / 60) % 12;
  if (minute > 35) hour = (hour + 1) % 12;
  return minute >= 25 && minute <= 35 ? CLOCKS.half[hour] : CLOCKS.hour[hour];
}

function formatTimeRange(start: number, end: number) {
  const startPeriod = meridiem(start);
  const endPeriod = meridiem(end);
  return startPeriod === endPeriod
    ? `${formatClock(start)}–${formatClock(end)} ${endPeriod}`
    : `${formatClock(start)} ${startPeriod}–${formatClock(end)} ${endPeriod}`;
}

function formatClock(minutes: number) {
  const normalized = normalizeMinutes(minutes);
  const hour = Math.floor(normalized / 60);
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${String(normalized % 60).padStart(2, "0")}`;
}

function meridiem(minutes: number) {
  return normalizeMinutes(minutes) < 720 ? "AM" : "PM";
}

function normalizeMinutes(minutes: number) {
  if (!Number.isFinite(minutes)) return 0;
  return ((Math.round(minutes) % 1440) + 1440) % 1440;
}

function buildHashtags(title: string, peopleCount: number) {
  const tags = ["#AGISummit"];
  if (peopleCount <= 2) tags.push("#AI");
  for (const topic of TOPIC_HASHTAGS) {
    if (topic.pattern.test(title) && !tags.includes(topic.hashtag)) tags.push(topic.hashtag);
    if (tags.length >= (peopleCount > 1 ? 4 : 5)) break;
  }
  if (peopleCount >= 3 && tags.length < 4) tags.push("#ArtificialIntelligence");
  if (peopleCount > 1) tags.push("#SanFrancisco");
  return tags.slice(0, 5).join(" ");
}

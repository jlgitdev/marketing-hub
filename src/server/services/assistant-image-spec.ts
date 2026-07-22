import { PLATFORM_CONFIG } from "@/lib/config";
import type { Platform } from "@/lib/types";

const MIN_PIXELS = 655_360;
const MAX_PIXELS = 8_294_400;
const MAX_EDGE = 3_840;

export interface AssistantImageSpec {
  width: number;
  height: number;
  size: string;
  aspectRatio: string;
  notes: string[];
}

export function resolveAssistantImageSpec(userPrompt: string, plannedAspectRatio: string, platform: Platform): AssistantImageSpec {
  const exact = explicitDimensions(userPrompt);
  if (exact) {
    const normalized = normalizeDimensions(exact.width, exact.height);
    const changed = normalized.width !== exact.width || normalized.height !== exact.height;
    return {
      ...normalized,
      size: `${normalized.width}x${normalized.height}`,
      aspectRatio: aspectLabel(normalized.width, normalized.height),
      notes: changed
        ? [`You requested ${exact.width} × ${exact.height}px. GPT Image 2 requires both edges to be multiples of 16 and applies size limits, so this first pass used ${normalized.width} × ${normalized.height}px without retrying.`]
        : []
    };
  }

  const requestedRatio = explicitRatio(userPrompt);
  const plannedRatio = parseRatio(plannedAspectRatio);
  const platformRatio = platform === "general"
    ? { width: 1, height: 1, label: "1:1" }
    : { ...PLATFORM_CONFIG[platform].image, label: aspectLabel(PLATFORM_CONFIG[platform].image.width, PLATFORM_CONFIG[platform].image.height) };
  const source = requestedRatio || plannedRatio || platformRatio;
  const clamped = clampRatio(source.width, source.height);
  const dimensions = dimensionsForRatio(clamped.width, clamped.height);
  const notes: string[] = [];
  if (requestedRatio && (clamped.width !== requestedRatio.width || clamped.height !== requestedRatio.height)) {
    notes.push(`You requested a ${requestedRatio.label} aspect ratio. GPT Image 2 supports ratios up to 3:1, so this first pass used ${aspectLabel(dimensions.width, dimensions.height)} without retrying.`);
  }
  return {
    ...dimensions,
    size: `${dimensions.width}x${dimensions.height}`,
    aspectRatio: requestedRatio && !notes.length ? requestedRatio.label : aspectLabel(dimensions.width, dimensions.height),
    notes
  };
}

function explicitDimensions(value: string) {
  const match = value.match(/\b(\d{3,4})\s*[x×]\s*(\d{3,4})\s*(?:px|pixels?)?\b/i);
  if (!match) return null;
  return { width: Number(match[1]), height: Number(match[2]) };
}

function explicitRatio(value: string) {
  const pattern = /\b(\d{1,2}(?:\.\d+)?)\s*:\s*(\d{1,2}(?:\.\d+)?)\b/g;
  for (const match of value.matchAll(pattern)) {
    const after = value.slice((match.index || 0) + match[0].length, (match.index || 0) + match[0].length + 5);
    if (/^\s*(?:am|pm)\b/i.test(after)) continue;
    const width = Number(match[1]);
    const height = Number(match[2]);
    if (width > 0 && height > 0) return { width, height, label: `${match[1]}:${match[2]}` };
  }
  return null;
}

function parseRatio(value: string) {
  const normalized = value.trim().toLowerCase();
  if (/\bsquare\b/.test(normalized)) return { width: 1, height: 1, label: "1:1" };
  if (/\bportrait\b/.test(normalized)) return { width: 4, height: 5, label: "4:5" };
  if (/\blandscape\b/.test(normalized)) return { width: 16, height: 9, label: "16:9" };
  const match = normalized.match(/(\d{1,2}(?:\.\d+)?)\s*:\s*(\d{1,2}(?:\.\d+)?)/);
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  return width > 0 && height > 0 ? { width, height, label: `${match[1]}:${match[2]}` } : null;
}

function clampRatio(width: number, height: number) {
  if (width / height > 3) return { width: 3, height: 1 };
  if (height / width > 3) return { width: 1, height: 3 };
  return { width, height };
}

function dimensionsForRatio(width: number, height: number) {
  const ratio = width / height;
  if (Math.abs(ratio - 1) < 0.01) return { width: 1024, height: 1024 };
  const raw = ratio > 1
    ? { width: 1536, height: 1536 / ratio }
    : { width: 1536 * ratio, height: 1536 };
  return normalizeDimensions(raw.width, raw.height);
}

function normalizeDimensions(inputWidth: number, inputHeight: number) {
  let width = Math.max(16, inputWidth);
  let height = Math.max(16, inputHeight);
  const requestedRatio = width / height;
  if (requestedRatio > 3) width = height * 3;
  else if (1 / requestedRatio > 3) height = width * 3;
  const ratio = width / height;

  const downscale = Math.min(1, MAX_EDGE / Math.max(width, height), Math.sqrt(MAX_PIXELS / (width * height)));
  width *= downscale;
  height *= downscale;
  const upscale = Math.max(1, Math.sqrt(MIN_PIXELS / (width * height)));
  width *= upscale;
  height *= upscale;
  width = nearest16(width);
  height = nearest16(height);

  while ((width * height > MAX_PIXELS || Math.max(width, height) > MAX_EDGE) && width > 16 && height > 16) {
    width -= 16;
    height = nearest16(width / ratio);
  }
  while (width * height < MIN_PIXELS) {
    if (ratio >= 1) {
      width += 16;
      height = nearest16(width / ratio);
    } else {
      height += 16;
      width = nearest16(height * ratio);
    }
  }
  return { width, height };
}

function nearest16(value: number) {
  return Math.max(16, Math.round(value / 16) * 16);
}

function aspectLabel(width: number, height: number) {
  const ratio = width / height;
  const common: Array<[number, string]> = [
    [1, "1:1"], [4 / 5, "4:5"], [3 / 4, "3:4"], [2 / 3, "2:3"],
    [5 / 4, "5:4"], [4 / 3, "4:3"], [3 / 2, "3:2"], [16 / 9, "16:9"], [9 / 16, "9:16"]
  ];
  const match = common.find(([candidate]) => Math.abs(candidate - ratio) / candidate < 0.012);
  if (match) return match[1];
  const divisor = greatestCommonDivisor(Math.round(width), Math.round(height));
  return `${Math.round(width / divisor)}:${Math.round(height / divisor)}`;
}

function greatestCommonDivisor(a: number, b: number): number {
  return b ? greatestCommonDivisor(b, a % b) : a;
}

import path from "node:path";
import sharp from "sharp";

const root = process.cwd();
const portraitPath = path.join(root, "assets/speaker-spotlight/xiaodi-hou-portrait-imagegen.png");
const referencePath = path.join(root, "assets/speaker-spotlight/henry-kang-speaker-spotlight.png");
const outputPath = path.join(root, "assets/speaker-spotlight/xiaodi-hou-speaker-spotlight.png");

const width = 1024;
const height = 1536;
const blue = "#112cff";
const black = "#05070c";

const agiLogo = await sharp(referencePath)
  .extract({ left: 716, top: 35, width: 280, height: 155 })
  .png()
  .toBuffer();

const overlay = `
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="panel" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#ffffff"/>
      <stop offset="0.82" stop-color="#ffffff"/>
      <stop offset="1" stop-color="#f1f1f1"/>
    </linearGradient>
    <filter id="shadow" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="5" stdDeviation="8" flood-color="#000000" flood-opacity="0.12"/>
    </filter>
  </defs>

  <path d="M0 0 H535 L314 1536 H0 Z" fill="url(#panel)"/>

  <g font-family="DIN Condensed, Avenir Next Condensed, Arial Narrow, sans-serif">
    <text x="54" y="181" font-size="40" font-weight="700" letter-spacing="0.8" fill="${blue}">FEATURED SPEAKER</text>
    <rect x="54" y="208" width="108" height="4" fill="${blue}"/>

    <text x="52" y="354" font-size="126" font-weight="700" letter-spacing="-1.5" fill="#050505">XIAODI</text>
    <text x="52" y="482" font-size="128" font-weight="700" letter-spacing="-1.5" fill="${blue}">HOU</text>
    <rect x="54" y="521" width="292" height="4" fill="${blue}"/>

    <g filter="url(#shadow)">
      <rect x="54" y="564" width="287" height="118" rx="12" fill="#ffffff"/>
      <path d="M79 594 H111 L127 623 L111 652 H79 L63 623 Z" fill="${blue}"/>
      <path d="M76 623 H114" stroke="#ffffff" stroke-width="5" stroke-linecap="round"/>
      <circle cx="84" cy="623" r="6" fill="#ffffff"/>
      <circle cx="106" cy="623" r="6" fill="#ffffff"/>
      <text x="143" y="635" font-family="Helvetica Neue, Arial, sans-serif" font-size="43" font-weight="700" letter-spacing="-1" fill="#070707">Bot Auto</text>
    </g>

    <rect x="55" y="729" width="47" height="4" fill="${blue}"/>
    <text x="54" y="791" font-family="Helvetica Neue, Arial, sans-serif" font-size="29" font-weight="500" fill="#090909">Founder &amp; CEO</text>

    <rect x="55" y="837" width="47" height="4" fill="${blue}"/>
    <text x="54" y="900" font-family="Helvetica Neue, Arial, sans-serif" font-size="25" fill="#111111">Autonomous Trucking</text>

    <text x="54" y="969" font-family="Helvetica Neue, Arial, sans-serif" font-size="17" fill="#111111">Autonomous Vehicles</text>
    <circle cx="211" cy="963" r="4" fill="${blue}"/>
    <text x="224" y="969" font-family="Helvetica Neue, Arial, sans-serif" font-size="17" fill="#111111">Robotics</text>

    <line x1="54" y1="1027" x2="328" y2="1027" stroke="#c7c7c7" stroke-width="2"/>

    <g transform="translate(55 1074)" stroke="${blue}" fill="none" stroke-width="3">
      <rect x="0" y="8" width="38" height="34" rx="5"/>
      <line x1="8" y1="0" x2="8" y2="14"/>
      <line x1="30" y1="0" x2="30" y2="14"/>
      <line x1="0" y1="18" x2="38" y2="18"/>
      <circle cx="11" cy="27" r="1.5" fill="${blue}"/>
      <circle cx="20" cy="27" r="1.5" fill="${blue}"/>
      <circle cx="29" cy="27" r="1.5" fill="${blue}"/>
      <circle cx="11" cy="35" r="1.5" fill="${blue}"/>
      <circle cx="20" cy="35" r="1.5" fill="${blue}"/>
    </g>
    <text x="119" y="1110" font-family="Helvetica Neue, Arial, sans-serif" font-size="25" font-weight="600" fill="#0a0a0a">July 18–19, 2026</text>

    <line x1="54" y1="1150" x2="316" y2="1150" stroke="#c7c7c7" stroke-width="2"/>

    <g transform="translate(56 1185)" stroke="${blue}" fill="none" stroke-width="3">
      <path d="M19 0 C7 0 0 9 0 20 C0 35 19 52 19 52 C19 52 38 35 38 20 C38 9 31 0 19 0 Z"/>
      <circle cx="19" cy="19" r="7"/>
    </g>
    <text x="119" y="1215" font-family="Helvetica Neue, Arial, sans-serif" font-size="23" font-weight="500" fill="#0a0a0a">Palace of Fine Arts,</text>
    <text x="119" y="1247" font-family="Helvetica Neue, Arial, sans-serif" font-size="23" font-weight="500" fill="#0a0a0a">San Francisco</text>

    <line x1="54" y1="1295" x2="297" y2="1295" stroke="#c7c7c7" stroke-width="2"/>

    <g transform="translate(56 1335)" stroke="${blue}" fill="none" stroke-width="3">
      <circle cx="19" cy="19" r="18"/>
      <ellipse cx="19" cy="19" rx="8" ry="18"/>
      <line x1="1" y1="19" x2="37" y2="19"/>
      <path d="M5 9 C13 13 25 13 33 9"/>
      <path d="M5 29 C13 25 25 25 33 29"/>
    </g>
    <text x="119" y="1369" font-family="Helvetica Neue, Arial, sans-serif" font-size="25" font-weight="600" fill="#0a0a0a">agisummit.ai</text>
  </g>
</svg>`;

const shiftedPortrait = await sharp(portraitPath)
  .resize(width, height, { fit: "cover" })
  .extract({ left: 0, top: 0, width: 924, height })
  .png()
  .toBuffer();

await sharp({ create: { width, height, channels: 3, background: black } })
  .composite([
    { input: shiftedPortrait, top: 0, left: 100 },
    { input: Buffer.from(overlay), top: 0, left: 0 },
    { input: agiLogo, top: 35, left: 716 }
  ])
  .png()
  .toFile(outputPath);

console.log(outputPath);

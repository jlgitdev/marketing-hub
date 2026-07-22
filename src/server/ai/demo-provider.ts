import type { ResearchBundle, OutreachBundle, SocialBundle } from "./schemas";
import type { ContextDocument, LeadRecord, Platform } from "@/lib/types";

const accessedAt = "2026-07-12T16:00:00.000Z";

export const DEMO_FAILURE_TRIGGERS = {
  provider: "[demo-provider-error]",
  image: "[demo-image-error]"
} as const;

export function demoResearchBundle(): ResearchBundle {
  return {
    warnings: ["Demo results are fictional and were not researched on the live web."],
    leads: [
      {
        opportunityClass: "organization", organizationName: "Bay Circuit AI Community", organizationType: "AI community",
        organizationWebsite: "https://baycircuit.example", city: "Oakland", region: "California", eventName: null, eventUrl: null,
        eventStartDate: null, eventEndDate: null, eventOrganizer: null, contactName: null, contactRole: "Partnerships team",
        contactEmail: "partnerships@baycircuit.example", emailCategory: "role_based", emailSourceUrl: "https://baycircuit.example/partners",
        contactPageUrl: "https://baycircuit.example/contact", recommendedAction: "Ask the community team to share a member invitation and offer a forwardable announcement.",
        fitExplanation: "Its fictional member profile overlaps with AI builders, technical founders, and event-curious professionals.",
        evidenceSummary: "The official fictional community and partners pages describe Bay Area AI programming and publish a role inbox.",
        targetSegment: "ai_professionals", salesMotion: "partner_distribution",
        qualificationSignals: { audienceFit: "exact", buyingSignal: "moderate", distributionPotential: "high", localRelevance: "local", timingFit: "urgent", decisionMakerAccess: "influencer", audienceSizeLabel: "Regional AI builder community" },
        outreachAngle: "Give the community a useful, ready-to-forward invitation for Bay Area AI practitioners.",
        nextBestAction: "Email the partnerships inbox with a forwardable announcement and tracked ticket link.",
        supportingSources: [
          { title: "Bay Circuit community programs", url: "https://baycircuit.example/programs", sourceType: "official", claim: "Runs fictional Bay Area AI community programs.", accessedAt },
          { title: "Bay Circuit partnerships", url: "https://baycircuit.example/partners", sourceType: "official", claim: "Publishes partnerships@baycircuit.example for partnership requests.", accessedAt },
          { title: "Bay Circuit contact", url: "https://baycircuit.example/contact", sourceType: "official", claim: "Provides the fictional community's official contact page.", accessedAt }
        ], confidence: "high", verificationStatus: "source_backed", warnings: []
      },
      {
        opportunityClass: "event", organizationName: "Signal Foundry", organizationType: "Startup community",
        organizationWebsite: "https://signalfoundry.example", city: "San Francisco", region: "California", eventName: "Responsible AI Builder Night",
        eventUrl: "https://signalfoundry.example/events/responsible-ai-night", eventStartDate: "2026-08-19", eventEndDate: "2026-08-19",
        eventOrganizer: "Signal Foundry Programs", contactName: null, contactRole: "Programs team", contactEmail: null, emailCategory: "none", emailSourceUrl: null,
        contactPageUrl: "https://signalfoundry.example/contact", recommendedAction: "Explore a cross-promotion exchange with the event organizer.",
        fitExplanation: "The upcoming fictional program is aimed at builders interested in responsible AI deployment.",
        evidenceSummary: "The official fictional event page lists the program date and organizer; only a contact form is published.",
        targetSegment: "founders_operators", salesMotion: "cross_promotion",
        qualificationSignals: { audienceFit: "strong", buyingSignal: "weak", distributionPotential: "moderate", localRelevance: "local", timingFit: "good", decisionMakerAccess: "influencer", audienceSizeLabel: "Local builder event audience" },
        outreachAngle: "Offer a reciprocal event mention to reach responsible-AI builders.",
        nextBestAction: "Use the official contact form to propose a simple cross-promotion swap.",
        supportingSources: [
          { title: "Responsible AI Builder Night", url: "https://signalfoundry.example/events/responsible-ai-night", sourceType: "event", claim: "Lists the fictional August 19 event and organizer.", accessedAt },
          { title: "Signal Foundry contact", url: "https://signalfoundry.example/contact", sourceType: "official", claim: "Provides an official contact page without a public email.", accessedAt }
        ], confidence: "medium", verificationStatus: "contact_page_only", warnings: ["Contact page only; no source-backed public email was found."]
      },
      {
        opportunityClass: "organization", organizationName: "Aperture Learning Lab", organizationType: "Educational nonprofit",
        organizationWebsite: "https://aperturelearning.example", city: "Berkeley", region: "California", eventName: null, eventUrl: null,
        eventStartDate: null, eventEndDate: null, eventOrganizer: null, contactName: "Jordan Example", contactRole: "Program coordinator",
        contactEmail: "jordan@example.net", emailCategory: "published_professional", emailSourceUrl: "https://directory.example/aperture-learning",
        contactPageUrl: "https://aperturelearning.example/contact", recommendedAction: "Invite educators and advanced students through the program team.",
        fitExplanation: "Its fictional curriculum connects applied AI with professional education.", evidenceSummary: "An official program page supports the fit; a third-party directory is the only email source.",
        targetSegment: "college_prep_education", salesMotion: "education_distribution",
        qualificationSignals: { audienceFit: "strong", buyingSignal: "moderate", distributionPotential: "moderate", localRelevance: "local", timingFit: "good", decisionMakerAccess: "influencer", audienceSizeLabel: "Educators and advanced students" },
        outreachAngle: "Frame the summit as career exposure and advanced AI learning for educators and students.",
        nextBestAction: "Verify an official program contact, then request educator and student distribution.",
        supportingSources: [
          { title: "Aperture AI curriculum", url: "https://aperturelearning.example/programs/ai", sourceType: "official", claim: "Describes a fictional applied AI curriculum.", accessedAt },
          { title: "Aperture contact", url: "https://aperturelearning.example/contact", sourceType: "official", claim: "Provides the fictional program's official contact page.", accessedAt },
          { title: "Community directory", url: "https://directory.example/aperture-learning", sourceType: "directory", claim: "Lists jordan@example.net; official confirmation was not found.", accessedAt }
        ], confidence: "low", verificationStatus: "requires_review", warnings: ["Consumer-domain email appears only on a third-party source and requires review."]
      },
      {
        opportunityClass: "organization", organizationName: "Northstar Systems Learning Council", organizationType: "Technology employer learning program",
        organizationWebsite: "https://northstar-systems.example", city: "San Jose", region: "California", eventName: null, eventUrl: null,
        eventStartDate: null, eventEndDate: null, eventOrganizer: null, contactName: "Morgan Example", contactRole: "Director of Learning and Development",
        contactEmail: "learning@northstar-systems.example", emailCategory: "role_based", emailSourceUrl: "https://northstar-systems.example/learning",
        contactPageUrl: "https://northstar-systems.example/contact", recommendedAction: "Offer a team-ticket package positioned as practical AI professional development.",
        fitExplanation: "Its fictional employer learning council funds technical professional development for Bay Area engineering and product employees.",
        evidenceSummary: "The official fictional learning page describes employee conference budgets and publishes the learning-team inbox.",
        targetSegment: "technology_employees", salesMotion: "employer_learning_budget",
        qualificationSignals: { audienceFit: "strong", buyingSignal: "strong", distributionPotential: "moderate", localRelevance: "local", timingFit: "good", decisionMakerAccess: "decision_maker", audienceSizeLabel: "Bay Area engineering and product teams" },
        outreachAngle: "Position a small ticket bundle as immediately applicable AI professional development.",
        nextBestAction: "Email the learning team with a three-tier group-ticket proposal.",
        supportingSources: [
          { title: "Northstar employee learning", url: "https://northstar-systems.example/learning", sourceType: "official", claim: "Publishes learning@northstar-systems.example and describes conference learning budgets.", accessedAt },
          { title: "Northstar San Jose office", url: "https://northstar-systems.example/about", sourceType: "official", claim: "Confirms a fictional San Jose technology workforce.", accessedAt },
          { title: "Northstar contact", url: "https://northstar-systems.example/contact", sourceType: "official", claim: "Provides the fictional employer's official contact page.", accessedAt }
        ], confidence: "high", verificationStatus: "source_backed", warnings: []
      },
      {
        opportunityClass: "organization", organizationName: "Bay Circuit AI Community", organizationType: "Technology community",
        organizationWebsite: "https://baycircuit.example/about", city: "Oakland", region: "California", eventName: null, eventUrl: null,
        eventStartDate: null, eventEndDate: null, eventOrganizer: null, contactName: null, contactRole: "Community team",
        contactEmail: "partnerships@baycircuit.example", emailCategory: "role_based", emailSourceUrl: "https://baycircuit.example/partners",
        contactPageUrl: "https://baycircuit.example/contact", recommendedAction: "Ask for community distribution.", fitExplanation: "Duplicate fixture for merge validation.",
        evidenceSummary: "The same role inbox is published on the official partner page.",
        targetSegment: "ai_professionals", salesMotion: "partner_distribution",
        qualificationSignals: { audienceFit: "exact", buyingSignal: "moderate", distributionPotential: "high", localRelevance: "local", timingFit: "urgent", decisionMakerAccess: "influencer", audienceSizeLabel: "Regional AI builder community" },
        outreachAngle: "Give the community a useful, ready-to-forward invitation.", nextBestAction: "Email the partnerships inbox.",
        supportingSources: [{ title: "Bay Circuit about", url: "https://baycircuit.example/about", sourceType: "official", claim: "Describes the same fictional community.", accessedAt }, { title: "Bay Circuit partnerships", url: "https://baycircuit.example/partners", sourceType: "official", claim: "Publishes partnerships@baycircuit.example.", accessedAt }, { title: "Bay Circuit contact", url: "https://baycircuit.example/contact", sourceType: "official", claim: "Provides the fictional community's official contact page.", accessedAt }],
        confidence: "high", verificationStatus: "source_backed", warnings: ["Intentional duplicate demo fixture."]
      }
    ]
  };
}

export function demoOutreachBundle(mode: "partner_share" | "direct_invitation" | "sales_motion", leads: LeadRecord[]): OutreachBundle {
  const partner = mode === "partner_share";
  const adaptive = mode === "sales_motion";
  const adaptiveAsk = (lead: LeadRecord) => lead.salesMotion === "employer_learning_budget" || lead.salesMotion === "group_ticket_sales"
    ? `Would ${lead.organizationName} consider a small team-ticket package as practical AI professional development?`
    : lead.salesMotion === "partner_distribution" || lead.salesMotion === "education_distribution" || lead.salesMotion === "cross_promotion"
      ? `Would ${lead.organizationName} share a ready-to-forward summit invitation with the relevant members of its audience?`
      : `We’d like to invite ${lead.organizationName} to the Applied Intelligence Forum.`;
  return {
    campaignName: partner ? "Bay Area partner-share outreach" : adaptive ? "Qualified summit sales outreach" : "Bay Area invitations",
    subjectTemplate: partner ? "A practical AI event for {{organization_name}}’s community" : "Invitation for {{organization_name}}: Applied Intelligence Forum",
    bodyTemplate: partner
      ? "Hi {{contact_first_name}},\n\nI’m reaching out because {{organization_name}} serves people building and learning with AI. Would you consider sharing the Applied Intelligence Forum with your community?\n\nThe forum takes place October 14, 2026 at Pier 27 in San Francisco. Details: {{ticket_url}}\n\nI included a short announcement below if useful.\n\nBest,\nThe Applied Intelligence Forum team"
      : "Hi {{contact_first_name}},\n\nWe’d like to invite {{organization_name}} to the Applied Intelligence Forum on October 14, 2026 at Pier 27 in San Francisco. The program is designed for builders, researchers, and community leaders working on practical AI.\n\nDetails: {{ticket_url}}\n\nBest,\nThe Applied Intelligence Forum team",
    callToAction: partner ? "Share the event with the relevant community." : "Review the event details and attend.",
    previewText: "A source-backed invitation prepared for review.",
    forwardableAnnouncement: "Applied Intelligence Forum brings builders, researchers, and community leaders together in San Francisco on October 14, 2026. Learn more at {{ticket_url}}.",
    missingContextWarnings: [],
    recipients: leads.map((lead) => ({
      leadId: lead.id,
      subject: partner ? `A practical AI event for ${lead.organizationName}’s community` : adaptive ? `${lead.salesMotion === "employer_learning_budget" || lead.salesMotion === "group_ticket_sales" ? "Team attendance" : "Applied AI summit"} for ${lead.organizationName}` : `Invitation for ${lead.organizationName}: Applied Intelligence Forum`,
      body: `${lead.contactName ? `Hi ${lead.contactName.split(" ")[0]},` : "Hello,"}\n\n${partner ? `Because ${lead.organizationName} ${lead.fitExplanation.toLowerCase()}, would you consider sharing the Applied Intelligence Forum with your audience?` : adaptive ? adaptiveAsk(lead) : `We’d like to invite ${lead.organizationName} to the Applied Intelligence Forum.`}\n\nThe forum takes place October 14, 2026 at Pier 27 in San Francisco. Details: https://forum.example/tickets\n\nBest,\nThe Applied Intelligence Forum team`,
      forwardableAnnouncement: "Applied Intelligence Forum brings builders, researchers, and community leaders together in San Francisco on October 14, 2026. Details: https://forum.example/tickets",
      warnings: lead.verificationStatus === "requires_review" ? ["Recipient contact evidence requires review."] : []
    }))
  };
}

export function demoSocialBundle(platforms: Platform[]): SocialBundle {
  const all: Record<Platform, SocialBundle["posts"][number]> = {
    general: { platform: "general", text: "The most useful conversations about AI happen when research, product practice, and community experience share the same room. Applied Intelligence Forum brings builders, researchers, educators, and community leaders together in San Francisco for a focused day on turning ambition into responsible practice.", hook: "Where research, practice, and community experience meet.", callToAction: "Explore the program and reserve a place", hashtags: "#AppliedAI #ResponsibleAI", imageHeadline: "Applied Intelligence Forum", imageSubheadline: "Build what comes next — responsibly", imageAltText: "Layered cobalt and warm geometric paths converge around a luminous gathering point.", imagePrompt: "Create one complete premium editorial conference graphic with layered cobalt and warm geometric paths, a luminous human-scale gathering point, subtle paper texture, and a clear typographic hierarchy. Render the exact headline \"Applied Intelligence Forum\", the exact supporting line \"Build what comes next — responsibly\", and the exact footer \"Explore the program and reserve a place\". Reproduce the supplied official logo faithfully. No extra or invented words.", warnings: [], styleGuideStatus: "fallback" },
    x: { platform: "x", text: "Practical AI needs more than demos. Join builders, researchers, and community leaders at Applied Intelligence Forum — Oct 14 in San Francisco. Explore the program: https://forum.example/tickets", hook: "Practical AI needs more than demos.", callToAction: "Explore the program", hashtags: "#AppliedAI #SanFrancisco", imageHeadline: "Applied Intelligence Forum", imageSubheadline: "October 14 · San Francisco", imageAltText: "Abstract cobalt pathways converging around a bright central forum mark.", imagePrompt: "Create one complete editorial campaign graphic with cobalt pathways converging around a warm central light and a premium technology-conference mood. Render the exact headline \"Applied Intelligence Forum\", the exact supporting line \"October 14 · San Francisco\", and the exact footer \"Explore the program\". Reproduce the supplied official logo faithfully. No extra or invented words.", warnings: [], styleGuideStatus: "selected_guide" },
    linkedin: { platform: "linkedin", text: "The most useful conversations about AI happen when research, product practice, and community experience share the same room.\n\nApplied Intelligence Forum brings builders, researchers, educators, and community leaders together in San Francisco on October 14 for a focused day on turning AI ambition into responsible practice.\n\nExplore the program and reserve a place: https://forum.example/tickets", hook: "Where research, product practice, and community experience meet.", callToAction: "Explore the program and reserve a place", hashtags: "#AppliedAI #AILeadership #SanFrancisco", imageHeadline: "Applied Intelligence Forum", imageSubheadline: "Build what comes next — responsibly", imageAltText: "Layered cobalt and sand-colored forms forming a precise gathering point.", imagePrompt: "Create one complete refined editorial conference graphic with layered cobalt and warm sand geometric forms, human-scale technology, subtle paper texture, and polished typography. Render the exact headline \"Applied Intelligence Forum\", the exact supporting line \"Build what comes next — responsibly\", and the exact footer \"Explore the program and reserve a place\". Reproduce the supplied official logo faithfully. No extra or invented words.", warnings: [], styleGuideStatus: "selected_guide" },
    instagram: { platform: "instagram", text: "Ideas become useful when the right people can test them together.\n\nOn October 14, Applied Intelligence Forum gathers builders, researchers, educators, and community leaders in San Francisco for a practical look at responsible AI.\n\nSave the date and explore the program at the link.", hook: "Ideas become useful when the right people test them together.", callToAction: "Save the date and explore the program", hashtags: "#AppliedAI #AIForum #SanFranciscoEvents #ResponsibleAI", imageHeadline: "Applied Intelligence Forum", imageSubheadline: "October 14 · Pier 27", imageAltText: "A luminous cobalt meeting point surrounded by layered warm geometric paths.", imagePrompt: "Create one complete portrait campaign graphic with a luminous cobalt meeting point, layered warm geometric paths, sophisticated AI-event art direction, and a bold legible hierarchy. Render the exact headline \"Applied Intelligence Forum\", the exact supporting line \"October 14 · Pier 27\", and the exact footer \"Save the date and explore the program\". Reproduce the supplied official logo faithfully. No extra or invented words.", warnings: [], styleGuideStatus: "selected_guide" }
  };
  return { campaignConcept: "A calm, practical gathering point for people shaping applied AI.", warnings: [], posts: platforms.map((platform) => all[platform]) };
}

export const DEMO_CONTEXT: Array<Omit<ContextDocument, "id" | "createdAt" | "updatedAt">> = [
  { title: "Applied Intelligence Forum — event brief", type: "event_brief", body: "# Applied Intelligence Forum\n\nDate: October 14, 2026\nLocation: Pier 27, San Francisco\nTicket URL: https://forum.example/tickets\n\nA one-day fictional gathering for builders, researchers, educators, and community leaders focused on practical, responsible AI.", active: true, sourceOfTruth: true, notes: "Fictional demo context." },
  { title: "Brand voice", type: "brand_voice", body: "Write with calm confidence. Prefer specific, useful language. Avoid hype, inevitability claims, and exaggerated urgency.", active: true, sourceOfTruth: false, notes: "Fictional demo context." },
  { title: "Target audience", type: "target_audience", body: "AI product builders, researchers, technical founders, educators, community organizers, and responsible-technology leaders in the Bay Area.", active: true, sourceOfTruth: false, notes: "Fictional demo context." },
  { title: "Outreach guidance", type: "outreach_guidance", body: "Lead with audience fit. Make one clear request. Never imply an existing relationship. Offer a short forwardable announcement to partners.", active: true, sourceOfTruth: false, notes: "Fictional demo context." },
  { title: "LinkedIn style", type: "platform_guidance", body: "Use a strong point of view, short paragraphs, professional specificity, and one clear call to action. Avoid engagement bait.", active: true, sourceOfTruth: false, notes: "Fictional demo context." },
  { title: "X style", type: "platform_guidance", body: "Open with the idea. Keep it compact, concrete, and under the configured limit. Use no more than two hashtags.", active: true, sourceOfTruth: false, notes: "Fictional demo context." },
  { title: "Instagram style", type: "platform_guidance", body: "Use a visual hook, readable caption rhythm, and a separate restrained hashtag set. Do not describe unsupported visuals.", active: true, sourceOfTruth: false, notes: "Fictional demo context." }
].map((document) => ({ ...document, summary: document.body.slice(0, 180), tags: [document.type.replaceAll("_", " ")], platforms: document.type === "platform_guidance" ? [document.title.toLowerCase().split(" ")[0] === "twitter" ? "x" : document.title.toLowerCase().split(" ")[0]] : [], purposes: document.type === "outreach_guidance" ? ["outreach"] : document.type === "platform_guidance" ? ["content"] : ["research", "outreach", "content"], origin: "demo" as const, sourcePath: null, contentHash: null }));

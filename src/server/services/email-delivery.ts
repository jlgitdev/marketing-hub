/**
 * Deliberate future boundary only. The MVP has no implementation, provider,
 * credentials, scheduler, or UI action that can transmit email.
 */
export interface ApprovedEmailDraft {
  recipientEmail: string;
  subject: string;
  body: string;
  campaignId: string;
  recipientId: string;
}

export interface EmailDeliveryAdapter {
  deliverApprovedDraft(draft: ApprovedEmailDraft): Promise<{ externalId: string }>;
}

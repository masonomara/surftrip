import { Resend } from "resend";

// -----------------------------------------------------------------------------
// Configuration
// -----------------------------------------------------------------------------

const DEFAULT_FROM_ADDRESS = "Docket <noreply@mail.docketadmin.com>";
const APP_URL = "https://docketadmin.com";

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface EmailEnv {
  RESEND_API_KEY: string;
  FROM_EMAIL?: string;
}

interface SendResult {
  success: boolean;
  error?: string;
}

// -----------------------------------------------------------------------------
// HTML Template Helpers
// -----------------------------------------------------------------------------

function button(text: string, href: string): string {
  const style = [
    "display: inline-block",
    "padding: 12px 24px",
    "background: #2563eb",
    "color: #fff",
    "text-decoration: none",
    "border-radius: 6px",
  ].join("; ");

  return `<a href="${href}" style="${style}">${text}</a>`;
}

function mutedText(text: string): string {
  return `<p style="color: #6b7280; font-size: 14px;">${text}</p>`;
}

// -----------------------------------------------------------------------------
// Core Email Sender
// -----------------------------------------------------------------------------

async function sendEmail(
  env: EmailEnv,
  to: string,
  subject: string,
  html: string,
  text: string
): Promise<SendResult> {
  const resend = new Resend(env.RESEND_API_KEY);

  const result = await resend.emails.send({
    from: env.FROM_EMAIL ?? DEFAULT_FROM_ADDRESS,
    to,
    subject,
    html,
    text,
  });

  if (result.error) {
    return { success: false, error: result.error.message };
  }

  return { success: true };
}

// -----------------------------------------------------------------------------
// Invitation Email
// -----------------------------------------------------------------------------

export interface SendInvitationInput {
  to: string;
  orgName: string;
  inviterName: string;
  role: string;
  invitationId: string;
}

export async function sendInvitationEmail(
  env: EmailEnv,
  input: SendInvitationInput
): Promise<SendResult> {
  const { to, orgName, inviterName, role, invitationId } = input;
  const acceptUrl = `${APP_URL}/auth?invitation=${invitationId}`;

  const subject = `You've been invited to join ${orgName} on Docket`;

  const html = `
    <p>${inviterName} has invited you to join <strong>${orgName}</strong> as a ${role}.</p>
    <p>Docket is an AI assistant for law firms that helps with case information, firm procedures, and Clio operations.</p>
    <p>${button("Accept Invitation", acceptUrl)}</p>
    ${mutedText("This invitation expires in 7 days.")}
  `.trim();

  const text = [
    `${inviterName} has invited you to join ${orgName} as a ${role}.`,
    "",
    `Accept the invitation: ${acceptUrl}`,
    "",
    "This invitation expires in 7 days.",
  ].join("\n");

  return sendEmail(env, to, subject, html, text);
}

// -----------------------------------------------------------------------------
// Password Reset Email
// -----------------------------------------------------------------------------

export interface SendPasswordResetInput {
  to: string;
  resetUrl: string;
}

export async function sendPasswordResetEmail(
  env: EmailEnv,
  input: SendPasswordResetInput
): Promise<SendResult> {
  const { to, resetUrl } = input;

  const subject = "Reset your Docket password";

  const html = `
    <p>You requested a password reset for your Docket account.</p>
    <p>${button("Reset Password", resetUrl)}</p>
    ${mutedText("If you didn't request this, you can ignore this email.")}
    ${mutedText("This link expires in 1 hour.")}
  `.trim();

  const text = [
    "You requested a password reset for your Docket account.",
    "",
    `Reset your password: ${resetUrl}`,
    "",
    "If you didn't request this, you can ignore this email.",
    "This link expires in 1 hour.",
  ].join("\n");

  return sendEmail(env, to, subject, html, text);
}

// -----------------------------------------------------------------------------
// Email Verification Email
// -----------------------------------------------------------------------------

export interface SendVerificationInput {
  to: string;
  verificationUrl: string;
}

export async function sendVerificationEmail(
  env: EmailEnv,
  input: SendVerificationInput
): Promise<SendResult> {
  const { to, verificationUrl } = input;

  const subject = "Verify your Docket email";

  const html = `
    <p>Welcome to Docket! Please verify your email address.</p>
    <p>${button("Verify Email", verificationUrl)}</p>
    ${mutedText("If you didn't create a Docket account, you can ignore this email.")}
  `.trim();

  const text = [
    "Welcome to Docket! Please verify your email address.",
    "",
    `Verify your email: ${verificationUrl}`,
    "",
    "If you didn't create a Docket account, you can ignore this email.",
  ].join("\n");

  return sendEmail(env, to, subject, html, text);
}

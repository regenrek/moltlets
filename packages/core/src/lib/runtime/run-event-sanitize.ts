import { redactKnownSecrets } from "./redaction.js";

export const RUN_EVENT_MESSAGE_MAX_CHARS = 4000;

export type SanitizedRunEventMessage = {
  message: string;
  redacted: boolean;
};

export function sanitizeRunEventMessage(raw: string): SanitizedRunEventMessage {
  const trimmed = raw.trim();
  if (!trimmed) return { message: "", redacted: false };

  const redacted = redactKnownSecrets(trimmed);
  const message =
    redacted.text.length > RUN_EVENT_MESSAGE_MAX_CHARS
      ? `${redacted.text.slice(0, RUN_EVENT_MESSAGE_MAX_CHARS - 3)}...`
      : redacted.text;

  return { message, redacted: redacted.redacted };
}

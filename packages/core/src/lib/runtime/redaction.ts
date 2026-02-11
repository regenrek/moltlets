const URL_CREDENTIALS_RE = /(https?:\/\/)([^/\s@]+@)/g;
const AUTH_BEARER_RE = /(Authorization:\s*Bearer\s+)([^\s]+)/gi;
const AUTH_BASIC_RE = /(Authorization:\s*Basic\s+)([^\s]+)/gi;
const QUERY_SECRET_RE = /([?&](?:access_token|token|auth|api_key|apikey|apiKey)=)([^&\s]+)/gi;
const KEY_VALUE_SECRET_RE =
  /\b((?:access|refresh|id)?_?token|token|api_key|apikey|apiKey|secret|password)\b(\s*[:=]\s*)([^\s&]+)/gi;
const KEY_VALUE_SECRET_NAME_RE =
  /\b([A-Za-z0-9_]{1,64}(?:_?token|_?secret|_?password|_?api_key|_?apikey|_?private_key|_?access_key|_?client_secret))\b(\s*[:=]\s*)([^\s&]+)/gi;
const LONG_HEX_TOKEN_RE = /\b[a-f0-9]{32,}\b/gi;
const JWT_LIKE_TOKEN_RE = /\b[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/g;
const LONG_BASE64ISH_TOKEN_RE =
  /\b(?=[A-Za-z0-9+/_-]{40,}={0,2}\b)(?=[A-Za-z0-9+/_-]*[A-Za-z])(?=[A-Za-z0-9+/_-]*\d)[A-Za-z0-9+/_-]{40,}={0,2}\b/g;

export type RedactKnownSecretsResult = {
  text: string;
  redacted: boolean;
};

export function redactKnownSecrets(input: string): RedactKnownSecretsResult {
  let out = input;
  out = out.replace(URL_CREDENTIALS_RE, "$1<redacted>@");
  out = out.replace(AUTH_BEARER_RE, "$1<redacted>");
  out = out.replace(AUTH_BASIC_RE, "$1<redacted>");
  out = out.replace(QUERY_SECRET_RE, "$1<redacted>");
  out = out.replace(KEY_VALUE_SECRET_RE, "$1$2<redacted>");
  out = out.replace(KEY_VALUE_SECRET_NAME_RE, "$1$2<redacted>");
  out = out.replace(JWT_LIKE_TOKEN_RE, "<redacted>");
  out = out.replace(LONG_HEX_TOKEN_RE, "<redacted>");
  out = out.replace(LONG_BASE64ISH_TOKEN_RE, "<redacted>");
  return {
    text: out,
    redacted: out !== input,
  };
}

export function redactKnownSecretsText(input: string): string {
  return redactKnownSecrets(input).text;
}

#!/usr/bin/env bash
set -euo pipefail

app_id="${CLAWLETS_GH_APP_ID:-}"
installation_id="${CLAWLETS_GH_INSTALLATION_ID:-}"
private_key_path="${CLAWLETS_GH_PRIVATE_KEY_PATH:-}"

out_env_file="${CLAWLETS_GH_ENV_FILE:-}"
out_git_creds_file="${CLAWLETS_GH_GIT_CREDENTIALS_FILE:-}"
out_gitconfig_file="${CLAWLETS_GH_GITCONFIG_FILE:-}"

gateway_user="${CLAWLETS_GATEWAY_USER:-}"
gateway_group="${CLAWLETS_GATEWAY_GROUP:-}"

if [[ -z "${app_id}" || -z "${installation_id}" || -z "${private_key_path}" ]]; then
  echo "error: missing CLAWLETS_GH_APP_ID / CLAWLETS_GH_INSTALLATION_ID / CLAWLETS_GH_PRIVATE_KEY_PATH" >&2
  exit 2
fi
if [[ -z "${out_env_file}" || -z "${out_git_creds_file}" || -z "${out_gitconfig_file}" ]]; then
  echo "error: missing CLAWLETS_GH_ENV_FILE / CLAWLETS_GH_GIT_CREDENTIALS_FILE / CLAWLETS_GH_GITCONFIG_FILE" >&2
  exit 2
fi
if [[ -z "${gateway_user}" || -z "${gateway_group}" ]]; then
  echo "error: missing CLAWLETS_GATEWAY_USER / CLAWLETS_GATEWAY_GROUP" >&2
  exit 2
fi
if [[ ! -f "${private_key_path}" ]]; then
  echo "error: private key missing: ${private_key_path}" >&2
  exit 2
fi

b64url() {
  base64 -w0 | tr '+/' '-_' | tr -d '='
}

now="$(date +%s)"
iat="$((now - 30))"
exp="$((now + 540))" # GitHub requires exp within 10 minutes

header='{"alg":"RS256","typ":"JWT"}'
payload="{\"iat\":${iat},\"exp\":${exp},\"iss\":\"${app_id}\"}"

h64="$(printf '%s' "${header}" | b64url)"
p64="$(printf '%s' "${payload}" | b64url)"
signing_input="${h64}.${p64}"
sig="$(
  printf '%s' "${signing_input}" \
    | openssl dgst -sha256 -sign "${private_key_path}" -binary \
    | b64url
)"
jwt="${signing_input}.${sig}"

token_json="$(
  curl -fsS \
    -X POST \
    -H "Authorization: Bearer ${jwt}" \
    -H "Accept: application/vnd.github+json" \
    "https://api.github.com/app/installations/${installation_id}/access_tokens"
)"

token="$(printf '%s' "${token_json}" | jq -r '.token')"
if [[ -z "${token}" || "${token}" == "null" ]]; then
  echo "error: failed to mint GitHub installation token (no .token field)" >&2
  printf '%s\n' "${token_json}" >&2
  exit 1
fi

umask 077

tmp_env="$(mktemp)"
printf 'GH_TOKEN=%s\n' "${token}" >"${tmp_env}"
chown "${gateway_user}:${gateway_group}" "${tmp_env}"
chmod 0400 "${tmp_env}"
mv "${tmp_env}" "${out_env_file}"

tmp_creds="$(mktemp)"
printf 'https://x-access-token:%s@github.com\n' "${token}" >"${tmp_creds}"
chown "${gateway_user}:${gateway_group}" "${tmp_creds}"
chmod 0600 "${tmp_creds}"
mv "${tmp_creds}" "${out_git_creds_file}"

tmp_gitcfg="$(mktemp)"
cat >"${tmp_gitcfg}" <<EOF
[credential]
	helper = store --file ${out_git_creds_file}
EOF
chown "${gateway_user}:${gateway_group}" "${tmp_gitcfg}"
chmod 0600 "${tmp_gitcfg}"
mv "${tmp_gitcfg}" "${out_gitconfig_file}"

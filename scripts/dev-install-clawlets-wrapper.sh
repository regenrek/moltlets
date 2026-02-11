#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cli_name="clawlets"
typo_name="clawdlets"
block_begin="# >>> clawlets PATH >>>"
block_end="# <<< clawlets PATH <<<"
dry_run=0
path_edit=1
path_shells="${CLAWLETS_PATH_SHELLS:-auto}"
target_shells=""

usage() {
  cat <<EOF
Usage: $(basename "$0") [options]

Install a local clawlets wrapper and ensure the install directory is on PATH.

Options:
  --dry-run             Print planned actions without writing files.
  --no-path-edit        Install wrapper only; do not modify shell profiles.
  --path-shells <list>  Shell targets for PATH persistence.
                        Values: auto (default), all, or comma-separated:
                        posix,zsh,bash,fish,nushell,pwsh
  -h, --help            Show this help.

Environment:
  CLAWLETS_BIN_DIR      Install directory for wrapper (default: \$HOME/bin).
  CLAWLETS_PATH_SHELLS  Default for --path-shells.
EOF
}

die() {
  echo "error: $*" >&2
  exit 1
}

note() {
  echo "$*"
}

warn() {
  echo "warn: $*"
}

trim() {
  local value="$1"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf "%s" "$value"
}

resolve_home_path() {
  local raw="$1"
  case "$raw" in
    "~") printf "%s\n" "$HOME" ;;
    "~/"*) printf "%s/%s\n" "$HOME" "${raw#~/}" ;;
    *) printf "%s\n" "$raw" ;;
  esac
}

normalize_dir() {
  local dir="$1"
  while [[ "$dir" != "/" && "$dir" == */ ]]; do
    dir="${dir%/}"
  done
  printf "%s\n" "$dir"
}

escape_double_quotes() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  printf "%s" "$value"
}

escape_single_quotes() {
  local value="$1"
  value="${value//\'/\'\'}"
  printf "%s" "$value"
}

display_path() {
  local full="$1"
  if [[ "$full" == "$HOME" ]]; then
    printf "~\n"
    return
  fi
  if [[ "$full" == "$HOME/"* ]]; then
    printf "~/%s\n" "${full#"$HOME"/}"
    return
  fi
  printf "%s\n" "$full"
}

path_contains_dir() {
  local dir="$1"
  case ":${PATH:-}:" in
    *":$dir:"*) return 0 ;;
    *) return 1 ;;
  esac
}

add_target_shell() {
  local shell_name="$1"
  case " $target_shells " in
    *" $shell_name "*) ;;
    *) target_shells="${target_shells:+$target_shells }$shell_name" ;;
  esac
}

normalize_shell_name() {
  local raw
  raw="$(trim "$1")"
  case "$raw" in
    posix | zsh | bash | fish | nushell | pwsh) printf "%s\n" "$raw" ;;
    nu) printf "nushell\n" ;;
    powershell | powershell.exe) printf "pwsh\n" ;;
    *) return 1 ;;
  esac
}

resolve_pwsh_profile_path() {
  local cmd
  local out
  for cmd in pwsh powershell powershell.exe; do
    if command -v "$cmd" >/dev/null 2>&1; then
      out="$("$cmd" -NoLogo -NoProfile -Command 'Write-Output $PROFILE.CurrentUserAllHosts' 2>/dev/null | tr -d '\r' | head -n 1 || true)"
      out="$(trim "$out")"
      if [[ -n "$out" ]]; then
        printf "%s\n" "$out"
        return 0
      fi
    fi
  done
  printf "%s\n" "$HOME/.config/powershell/profile.ps1"
}

parse_path_shells() {
  local value="$1"
  local entry
  local normalized
  local shell_name
  local maybe_shell

  target_shells=""
  case "$value" in
    auto)
      maybe_shell="$(basename "${SHELL:-}")"
      case "$maybe_shell" in
        zsh) add_target_shell zsh ;;
        bash) add_target_shell bash ;;
        fish) add_target_shell fish ;;
        nu) add_target_shell nushell ;;
        pwsh | powershell | powershell.exe) add_target_shell pwsh ;;
      esac

      [[ -f "$HOME/.zshrc" || -f "$HOME/.zprofile" || -f "$HOME/.zshenv" ]] && add_target_shell zsh
      [[ -f "$HOME/.bashrc" || -f "$HOME/.bash_profile" || -f "$HOME/.bash_login" ]] && add_target_shell bash
      [[ -d "$HOME/.config/fish" || -f "$HOME/.config/fish/config.fish" ]] && add_target_shell fish
      [[ -d "$HOME/.config/nushell" || -f "$HOME/.config/nushell/env.nu" || -f "$HOME/.config/nushell/config.nu" ]] &&
        add_target_shell nushell
      [[ -f "$HOME/.config/powershell/profile.ps1" ]] && add_target_shell pwsh

      if [[ -z "$target_shells" ]]; then
        add_target_shell posix
      fi
      ;;
    all)
      add_target_shell posix
      add_target_shell zsh
      add_target_shell bash
      add_target_shell fish
      add_target_shell nushell
      add_target_shell pwsh
      ;;
    *)
      IFS=',' read -r -a shell_names <<<"$value"
      for shell_name in "${shell_names[@]}"; do
        entry="$(trim "$shell_name")"
        [[ -n "$entry" ]] || continue
        normalized="$(normalize_shell_name "$entry")" || die "unsupported shell in --path-shells: $entry"
        add_target_shell "$normalized"
      done
      [[ -n "$target_shells" ]] || die "--path-shells list is empty"
      ;;
  esac
}

build_sh_block() {
  local path_value="$1"
  local escaped
  escaped="$(escape_double_quotes "$path_value")"
  cat <<EOF
case ":\$PATH:" in
  *:"$escaped":*) ;;
  *) export PATH="$escaped:\$PATH" ;;
esac
EOF
}

build_fish_block() {
  local path_value="$1"
  local escaped
  escaped="$(escape_double_quotes "$path_value")"
  cat <<EOF
set -l clawlets_bin "$escaped"
if not contains -- \$clawlets_bin \$PATH
  set -gx PATH \$clawlets_bin \$PATH
end
EOF
}

build_nushell_block() {
  local path_value="$1"
  local escaped
  escaped="$(escape_single_quotes "$path_value")"
  cat <<EOF
let clawlets_bin = '$escaped'
if not (\$env.PATH | any {|p| \$p == \$clawlets_bin }) {
  \$env.PATH = (\$env.PATH | prepend \$clawlets_bin)
}
EOF
}

build_pwsh_block() {
  local path_value="$1"
  local escaped
  escaped="$(escape_single_quotes "$path_value")"
  cat <<EOF
\$clawletsBin = '$escaped'
\$pathSep = [System.IO.Path]::PathSeparator
\$parts = \$env:PATH -split [regex]::Escape([string]\$pathSep)
if (-not (\$parts -contains \$clawletsBin)) {
  \$env:PATH = "\$clawletsBin\$pathSep\$env:PATH"
}
EOF
}

file_mentions_path_entry() {
  local file="$1"
  [[ -f "$file" ]] || return 1
  grep -Fq "$bin_dir" "$file" && return 0
  if [[ "$bin_dir" == "$HOME/bin" ]]; then
    grep -Fq '$HOME/bin' "$file" && return 0
    grep -Fq '~/bin' "$file" && return 0
  fi
  return 1
}

upsert_block() {
  local file="$1"
  local label="$2"
  local content="$3"
  local tmp_without
  local tmp_next

  if file_mentions_path_entry "$file"; then
    note "ok: PATH already references $bin_dir in $label"
    return 0
  fi

  if ((dry_run)); then
    note "dry-run: would ensure PATH block in $label"
    return 0
  fi

  mkdir -p "$(dirname "$file")"
  tmp_without="$(mktemp)"
  tmp_next="$(mktemp)"

  if [[ -f "$file" ]]; then
    awk -v begin="$block_begin" -v end="$block_end" '
      $0 == begin { in_block = 1; next }
      $0 == end { in_block = 0; next }
      !in_block { print }
    ' "$file" >"$tmp_without"
  else
    : >"$tmp_without"
  fi

  {
    cat "$tmp_without"
    if [[ -s "$tmp_without" ]]; then
      printf "\n"
    fi
    printf "%s\n" "$block_begin"
    printf "%s\n" "$content"
    printf "%s\n" "$block_end"
  } >"$tmp_next"

  if [[ -f "$file" ]] && cmp -s "$file" "$tmp_next"; then
    rm -f "$tmp_without" "$tmp_next"
    note "ok: PATH block already up to date in $label"
    return 0
  fi

  mv "$tmp_next" "$file"
  rm -f "$tmp_without"
  note "ok: PATH persisted in $label"
}

ensure_posix_path() {
  local file="$HOME/.profile"
  upsert_block "$file" "$(display_path "$file")" "$(build_sh_block "$bin_dir")"
}

ensure_zsh_path() {
  local file
  for file in "$HOME/.zprofile" "$HOME/.zshrc"; do
    upsert_block "$file" "$(display_path "$file")" "$(build_sh_block "$bin_dir")"
  done
}

choose_bash_login_file() {
  local file
  for file in "$HOME/.bash_profile" "$HOME/.bash_login" "$HOME/.profile"; do
    if [[ -f "$file" ]]; then
      printf "%s\n" "$file"
      return 0
    fi
  done
  printf "%s\n" "$HOME/.bash_profile"
}

ensure_bash_path() {
  local login_file
  local bashrc="$HOME/.bashrc"
  login_file="$(choose_bash_login_file)"
  upsert_block "$login_file" "$(display_path "$login_file")" "$(build_sh_block "$bin_dir")"
  upsert_block "$bashrc" "$(display_path "$bashrc")" "$(build_sh_block "$bin_dir")"
}

ensure_fish_path() {
  local file="$HOME/.config/fish/conf.d/clawlets-path.fish"
  upsert_block "$file" "$(display_path "$file")" "$(build_fish_block "$bin_dir")"
}

ensure_nushell_path() {
  local file="$HOME/.config/nushell/env.nu"
  upsert_block "$file" "$(display_path "$file")" "$(build_nushell_block "$bin_dir")"
}

ensure_pwsh_path() {
  local file
  file="$(resolve_pwsh_profile_path)"
  upsert_block "$file" "$file" "$(build_pwsh_block "$bin_dir")"
}

print_reload_commands() {
  local shell_name
  note "next: reload updated profile files:"
  for shell_name in $target_shells; do
    case "$shell_name" in
      posix)
        note "  sh: . ~/.profile"
        ;;
      zsh)
        note "  zsh: source ~/.zprofile && source ~/.zshrc"
        ;;
      bash)
        note "  bash: { source ~/.bash_profile 2>/dev/null || source ~/.bash_login 2>/dev/null || source ~/.profile; } && source ~/.bashrc 2>/dev/null || true"
        ;;
      fish)
        note "  fish: source ~/.config/fish/conf.d/clawlets-path.fish"
        ;;
      nushell)
        note "  nushell: source ~/.config/nushell/env.nu"
        ;;
      pwsh)
        note '  pwsh: . $PROFILE.CurrentUserAllHosts'
        ;;
    esac
  done
  note "  alternative: start a new terminal session"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      dry_run=1
      ;;
    --no-path-edit)
      path_edit=0
      ;;
    --path-shells)
      [[ $# -ge 2 ]] || die "--path-shells requires a value"
      path_shells="$2"
      shift
      ;;
    --path-shells=*)
      path_shells="${1#*=}"
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    --)
      shift
      break
      ;;
    *)
      die "unknown option: $1"
      ;;
  esac
  shift
done

[[ $# -eq 0 ]] || die "unexpected positional arguments: $*"

path_shells="$(trim "$path_shells")"
[[ -n "$path_shells" ]] || die "--path-shells cannot be empty"

bin_dir="${CLAWLETS_BIN_DIR:-"$HOME/bin"}"
bin_dir="$(resolve_home_path "$bin_dir")"
bin_dir="$(normalize_dir "$bin_dir")"
[[ -n "$bin_dir" ]] || die "CLAWLETS_BIN_DIR resolved to empty"
[[ "$bin_dir" == /* ]] || die "CLAWLETS_BIN_DIR must resolve to an absolute path"
[[ "$bin_dir" != *$'\n'* ]] || die "CLAWLETS_BIN_DIR must not contain newlines"
[[ "$bin_dir" != *:* ]] || die "CLAWLETS_BIN_DIR must not contain ':'"

wrapper="$bin_dir/$cli_name"
typo_wrapper="$bin_dir/$typo_name"

if ((dry_run)); then
  note "dry-run: would ensure directory $bin_dir"
else
  mkdir -p "$bin_dir"
fi

# Build workspace deps first so cli runtime imports exist in dist/
if ((dry_run)); then
  note "dry-run: would run pnpm -C $repo_root -r build"
else
  pnpm -C "$repo_root" -r build >/dev/null
fi

if ((dry_run)); then
  note "dry-run: would write wrapper to $wrapper"
else
  cat >"$wrapper" <<EOF
#!/usr/bin/env bash
set -euo pipefail
node "$repo_root/packages/cli/dist/main.mjs" "\$@"
EOF
  chmod +x "$wrapper"
fi

if ((dry_run)); then
  note "ok: $wrapper (dry-run)"
else
  echo "ok: $wrapper"
fi

if ((path_edit)); then
  if path_contains_dir "$bin_dir"; then
    note "ok: PATH already contains $bin_dir"
  else
    parse_path_shells "$path_shells"
    for shell_name in $target_shells; do
      case "$shell_name" in
        posix) ensure_posix_path ;;
        zsh) ensure_zsh_path ;;
        bash) ensure_bash_path ;;
        fish) ensure_fish_path ;;
        nushell) ensure_nushell_path ;;
        pwsh) ensure_pwsh_path ;;
      esac
    done
    warn "PATH in your current shell has not changed. Start a new shell session or source updated profile files."
    print_reload_commands
  fi
else
  warn "PATH updates disabled (--no-path-edit). Ensure $bin_dir is on PATH manually."
fi

if [[ -e "$typo_wrapper" ]]; then
  warn "found typo wrapper: $typo_wrapper"
  warn "remove it to avoid confusion: trash \"$typo_wrapper\""
fi

if command -v "$typo_name" >/dev/null 2>&1; then
  warn "'$typo_name' is on PATH (stale typo binary)."
  warn "remove global typo package(s): pnpm remove -g clawdlets clawdlets-workspace"
fi

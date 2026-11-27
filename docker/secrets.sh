# File secrets for entrypoint.sh (sourced). Every reader (this, the backend's
# config and the frontend's server config) strips exactly one trailing line
# ending, "\r\n" or "\n", so a file saved on Windows gives the same key to every
# command (US-115.2).

secrets_dir=/run/secrets

load_secret() {
    local name="$1" canonical="$secrets_dir/$1" legacy="$secrets_dir/${1,,}" value
    if [[ -f "$canonical" && -f "$legacy" ]]; then
        echo "$name has ambiguous file-secret names; keep only the uppercase file" >&2
        exit 1
    fi
    if [[ -f "$legacy" ]]; then
        echo "$name uses a legacy file-secret name; rename it to uppercase" >&2
        exit 1
    fi
    if [[ -z "${!name:-}" && -f "$canonical" ]]; then
        # The trailing "." keeps the command substitution from dropping newlines.
        value="$(cat -- "$canonical"; printf .)"
        value="${value%.}"
        if [[ "$value" == *$'\r\n' ]]; then
            value="${value%$'\r\n'}"
        else
            value="${value%$'\n'}"
        fi
        printf -v "$name" '%s' "$value"
        export "$name"
    fi
}

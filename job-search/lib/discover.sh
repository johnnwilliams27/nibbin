#!/usr/bin/env bash
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
probe(){
  local fund="$1" host="$2"
  local body="/tmp/disc_$(echo "$host"|tr './:' '___').html"
  local out
  out=$(curl -sS --max-time 22 -L -H "User-Agent: $UA" -H "Accept: text/html" \
        -o "$body" -w "%{http_code}|%{url_effective}" "https://$host/" 2>/dev/null) || out="ERR|"
  local code="${out%%|*}" final="${out#*|}"
  local backend="unknown" nid=""
  if grep -qi 'getro' "$body" 2>/dev/null; then backend="getro"; fi
  if grep -qi 'consider\.com' "$body" 2>/dev/null; then backend="consider"; fi
  if grep -qi 'greenhouse\|lever\.co\|ashby' "$body" 2>/dev/null; then backend="${backend}+ats"; fi
  # getro network id from __NEXT_DATA__ "network":{"id":"NNN"
  nid=$(grep -oE '"network":\{"id":"?[0-9]+' "$body" 2>/dev/null | grep -oE '[0-9]+' | head -1)
  local size; size=$(wc -c < "$body" 2>/dev/null || echo 0)
  printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$fund" "$host" "$code" "$backend" "${nid:-}" "$final"
}
while IFS=$'\t' read -r fund host; do
  [ -z "$fund" ] && continue
  probe "$fund" "$host"
done

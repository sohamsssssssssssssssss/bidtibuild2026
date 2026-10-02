#!/usr/bin/env bash
# Rebuilds a throwaway database from scratch and runs the SQL tests:
#   shim (plain Postgres only) -> supabase/migrations/*.sql -> supabase/seed.sql -> supabase/tests/*.sql
#   -> node checks (check-transitions.ts, check-city-pulse-concurrency.ts)
#
# Usage: npm run db:test            # against local Postgres + PostGIS
#        DB_ADMIN_URL=... npm run db:test
#        SKIP_SEED=1 npm run db:test
# Each test file must raise an exception on failure (psql runs with ON_ERROR_STOP).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ADMIN_URL="${DB_ADMIN_URL:-postgresql://postgres:postgres@localhost:5432/postgres}"
DB_NAME="${DB_NAME:-civicpulse_test}"
DB_URL="${ADMIN_URL%/*}/${DB_NAME}"
PSQL=(psql -X -q -v ON_ERROR_STOP=1 --set=SHOW_CONTEXT=errors)

echo "==> recreating ${DB_NAME}"
"${PSQL[@]}" "$ADMIN_URL" -c "drop database if exists ${DB_NAME} with (force)" -c "create database ${DB_NAME}"
"${PSQL[@]}" "$DB_URL" -c "alter database ${DB_NAME} set search_path = \"\$user\", public, extensions"

echo "==> supabase shim"
"${PSQL[@]}" "$DB_URL" -f "$ROOT/scripts/db-test/supabase-shim.sql"

for f in "$ROOT"/supabase/migrations/*.sql; do
  [ -e "$f" ] || continue
  echo "==> migration $(basename "$f")"
  "${PSQL[@]}" "$DB_URL" -f "$f"
done

if [ -z "${SKIP_SEED:-}" ] && [ -f "$ROOT/supabase/seed.sql" ]; then
  echo "==> seed.sql"
  "${PSQL[@]}" "$DB_URL" -f "$ROOT/supabase/seed.sql"
fi

status=0
for t in "$ROOT"/supabase/tests/*.sql; do
  [ -e "$t" ] || continue
  if [ -n "${SKIP_SEED:-}" ] && [[ "$(basename "$t")" == *seed* ]]; then continue; fi
  if "${PSQL[@]}" "$DB_URL" -f "$t" > /tmp/db-test-out.$$ 2>&1; then
    echo "PASS $(basename "$t")"
  else
    echo "FAIL $(basename "$t")"; sed 's/^/    /' /tmp/db-test-out.$$; status=1
  fi
done

# 02 §15: the TS transitions (civic.ts STATUS_TRANSITIONS) match SQL (status_transition_rules()).
if node "$ROOT/scripts/db-test/check-transitions.ts" "$DB_URL" > /tmp/db-test-out.$$ 2>&1; then
  echo "PASS check-transitions.ts"
else
  echo "FAIL check-transitions.ts"; sed 's/^/    /' /tmp/db-test-out.$$; status=1
fi

# 02 §6.8: concurrent regenerate_city_pulse runs queue up (one active set). Leaves hotspot rows
# behind, so it runs after the SQL tests.
if node "$ROOT/scripts/db-test/check-city-pulse-concurrency.ts" "$DB_URL" > /tmp/db-test-out.$$ 2>&1; then
  echo "PASS check-city-pulse-concurrency.ts"
else
  echo "FAIL check-city-pulse-concurrency.ts"; sed 's/^/    /' /tmp/db-test-out.$$; status=1
fi
rm -f /tmp/db-test-out.$$
exit $status

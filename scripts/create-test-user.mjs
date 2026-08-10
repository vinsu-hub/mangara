/**
 * Creates a pre-confirmed test account for E2E runs.
 *
 * Supabase's free tier rate-limits confirmation emails hard, so signing up
 * through the UI repeatedly gets throttled. This uses the admin API to skip
 * confirmation entirely.
 *
 *   node --env-file=.env.local scripts/create-test-user.mjs
 *   node --env-file=.env.local scripts/create-test-user.mjs --delete <userId>
 */
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
);

const deleteIdx = process.argv.indexOf("--delete");
if (deleteIdx !== -1) {
  const id = process.argv[deleteIdx + 1];
  const { error } = await supabase.auth.admin.deleteUser(id);
  if (error) {
    console.error(error);
    process.exit(1);
  }
  console.log(`deleted ${id}`);
  process.exit(0);
}

const email = `mangara-e2e-${Date.now()}@gmail.com`;
const password = "e2e-password-123";

const { data, error } = await supabase.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
});

if (error) {
  console.error(error);
  process.exit(1);
}

console.log(
  JSON.stringify({ email, password, id: data.user.id }, null, 2)
);

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateDefaultProject } from "@/lib/projects";
import { AppShell } from "@/components/app-shell";

export default async function Home() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const project = await getOrCreateDefaultProject(supabase, user.id);

  return <AppShell projectName={project.name} userEmail={user.email ?? "?"} />;
}

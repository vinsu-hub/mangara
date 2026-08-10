import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateDefaultProject } from "@/lib/projects";
import { AppShell } from "@/components/app-shell";
import { errorMessage } from "@/lib/errors";

export default async function Home() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  try {
    const project = await getOrCreateDefaultProject(supabase);
    return (
      <AppShell
        projectId={project.id}
        projectName={project.name}
        userEmail={user.email ?? "?"}
      />
    );
  } catch (e) {
    const message = errorMessage(e);
    return (
      <div className="flex min-h-svh flex-col items-center justify-center gap-3 p-8 text-center">
        <h1 className="text-lg font-medium">Couldn&apos;t load your workspace</h1>
        <p className="max-w-md text-sm text-muted-foreground">{message}</p>
        <p className="max-w-md text-xs text-muted-foreground">
          If this mentions a missing table or function, run{" "}
          <code className="rounded bg-muted px-1">supabase/schema.sql</code> in
          the Supabase SQL Editor.
        </p>
      </div>
    );
  }
}

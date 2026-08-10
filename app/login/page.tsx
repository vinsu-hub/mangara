import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { signIn, signUp } from "./actions";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <div className="flex min-h-svh items-center justify-center bg-muted/30 p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">Mangara</CardTitle>
          <CardDescription>Sign in to your workspace</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="sign-in">
            <TabsList className="w-full">
              <TabsTrigger value="sign-in" className="flex-1">
                Sign in
              </TabsTrigger>
              <TabsTrigger value="sign-up" className="flex-1">
                Sign up
              </TabsTrigger>
            </TabsList>

            {error && (
              <p className="mt-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}

            <TabsContent value="sign-in">
              <form action={signIn} className="mt-4 flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" name="email" type="email" required />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="password">Password</Label>
                  <Input id="password" name="password" type="password" required />
                </div>
                <Button type="submit" className="w-full">
                  Sign in
                </Button>
              </form>
            </TabsContent>

            <TabsContent value="sign-up">
              <form action={signUp} className="mt-4 flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="signup-email">Email</Label>
                  <Input id="signup-email" name="email" type="email" required />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="signup-password">Password</Label>
                  <Input
                    id="signup-password"
                    name="password"
                    type="password"
                    minLength={6}
                    required
                  />
                </div>
                <Button type="submit" className="w-full">
                  Create account
                </Button>
              </form>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}

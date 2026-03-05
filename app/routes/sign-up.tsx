import { SignUp } from "@clerk/tanstack-react-start";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/sign-up")({
  component: SignUpRoute,
});

function SignUpRoute() {
  return (
    <main className="dashboard-shell py-8">
      <SignUp />
    </main>
  );
}

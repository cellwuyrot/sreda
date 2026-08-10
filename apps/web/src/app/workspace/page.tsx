"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import Spinner from "@/components/ui/Spinner";
import WorkspaceCanvas from "@/components/workspace/WorkspaceCanvas";

export default function WorkspacePage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === "unauthenticated") router.push("/auth/signin?callbackUrl=/workspace");
  }, [status, router]);

  if (status !== "authenticated") {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner />
      </div>
    );
  }

  return (
    <WorkspaceCanvas
      userId={session.user?.id ?? "anon"}
      userName={session.user?.name ?? "Профиль"}
    />
  );
}

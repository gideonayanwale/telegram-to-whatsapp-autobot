import type { Metadata } from "next";
import Link from "next/link";

import { unsubscribeByToken } from "@/lib/unsubscribe";

export const metadata: Metadata = {
  title: "Unsubscribe",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

type UnsubStatus = "done" | "already" | "invalid" | "missing" | "error";

export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: { [key: string]: string | string[] | undefined };
}) {
  const rawToken = searchParams.token;
  const token = typeof rawToken === "string" ? rawToken : null;

  let status: UnsubStatus = "missing";
  if (token) {
    status = (await unsubscribeByToken(token)) as UnsubStatus;
  }

  const copy: Record<UnsubStatus, { title: string; body: string }> = {
    done: {
      title: "You've been unsubscribed",
      body: "You will no longer receive email updates from this church. We're sorry to see you go — you can resubscribe any time from the church's event page.",
    },
    already: {
      title: "You're already unsubscribed",
      body: "This address is not receiving email updates from this church.",
    },
    invalid: {
      title: "This link is invalid",
      body: "The unsubscribe link you followed is invalid. If you no longer wish to receive these emails, please contact the church that sent them.",
    },
    missing: {
      title: "Missing unsubscribe token",
      body: "Please use the unsubscribe link from one of your emails.",
    },
    error: {
      title: "Something went wrong",
      body: "We couldn't process your request right now. Please try again in a moment.",
    },
  };

  const { title, body } = copy[status];

  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center px-4">
      <div className="max-w-md w-full rounded-2xl border border-border bg-card shadow-sm p-8 text-center space-y-4">
        <h1 className="text-2xl font-bold font-heading">{title}</h1>
        <p className="text-sm text-muted-foreground leading-relaxed">{body}</p>
        <div className="pt-2">
          <Link
            href="/"
            className="inline-flex items-center justify-center rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 transition-colors"
          >
            Back to Bent Planet
          </Link>
        </div>
      </div>
    </div>
  );
}

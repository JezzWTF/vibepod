"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ComponentProps } from "react";
import { runLeaveGuard } from "@/lib/navigation-guard";

type Props = Omit<ComponentProps<typeof Link>, "href"> & { href: string };

export default function GuardedLink({ href, onClick, ...props }: Props) {
  const router = useRouter();
  return (
    <Link
      href={href}
      onClick={async (event) => {
        onClick?.(event);
        if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey) return;
        event.preventDefault();
        if (await runLeaveGuard()) router.push(href);
      }}
      {...props}
    />
  );
}

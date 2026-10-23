"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ComponentProps } from "react";

type Props = Omit<ComponentProps<typeof Link>, "href" | "onNavigate">;

/** A logo always returns to the home hero, without adding a URL fragment. */
export function HomeLink(props: Props) {
  const router = useRouter();
  return <Link {...props} href="/" onNavigate={(event) => {
    if (window.location.pathname !== "/") return;
    event.preventDefault();
    if (window.location.hash || window.location.search) {
      router.push("/", { scroll: false });
    }
    window.scrollTo({ top: 0, left: 0 });
  }} />;
}

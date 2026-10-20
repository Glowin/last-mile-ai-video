import { Suspense } from "react";
import { Studio } from "@/components/studio";
export const metadata = {
  title: "Video Studio",
  robots: { index: false, follow: false },
};
export default function Create() {
  return (
    <Suspense
      fallback={
        <main id="main" className="shell section">
          Opening the studio…
        </main>
      }
    >
      <Studio />
    </Suspense>
  );
}

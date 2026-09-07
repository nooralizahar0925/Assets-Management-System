import type { ReactNode } from "react";

/**
 * Typographic wrapper for the portal's written pages.
 *
 * The dashboard's components are built for dense data; documentation needs
 * measure, spacing and heading rhythm instead. Keeping that here means the
 * pages themselves contain content rather than class names.
 */
export default function Prose({ children }: { children: ReactNode }) {
  return (
    <div
      className="
        max-w-3xl text-sm leading-relaxed text-gray-700 dark:text-gray-300
        [&_h2]:mt-10 [&_h2]:mb-3 [&_h2]:text-lg [&_h2]:font-medium
        [&_h2]:text-gray-800 dark:[&_h2]:text-white/90
        [&_h3]:mt-6 [&_h3]:mb-2 [&_h3]:text-base [&_h3]:font-medium
        [&_h3]:text-gray-800 dark:[&_h3]:text-white/90
        [&_p]:my-3
        [&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-6 [&_li]:my-1
        [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-6
        [&_a]:text-brand-500 hover:[&_a]:text-brand-600
        [&_code]:rounded [&_code]:bg-gray-100 [&_code]:px-1.5 [&_code]:py-0.5
        [&_code]:font-mono [&_code]:text-theme-xs dark:[&_code]:bg-white/10
        [&_table]:my-4 [&_table]:w-full [&_table]:text-left
        [&_th]:border-b [&_th]:border-gray-200 [&_th]:py-2 [&_th]:pr-4
        [&_th]:text-theme-xs [&_th]:font-medium [&_th]:text-gray-500
        dark:[&_th]:border-gray-800
        [&_td]:border-b [&_td]:border-gray-100 [&_td]:py-2 [&_td]:pr-4
        [&_td]:align-top dark:[&_td]:border-gray-800
      "
    >
      {children}
    </div>
  );
}

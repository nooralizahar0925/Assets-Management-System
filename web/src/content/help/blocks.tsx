/**
 * The vocabulary help content is written in.
 *
 * A small closed union rather than Markdown: it needs no parser, cannot inject
 * HTML, and is type-checked, so a typo in a block kind fails the build instead
 * of rendering as literal asterisks in front of a customer. The same blocks are
 * rendered by the help panel, the help centre and the printable guide, which is
 * what keeps those three from drifting apart.
 */
export type Block =
  | { kind: "p"; text: string }
  | { kind: "steps"; items: string[] }
  | { kind: "list"; items: string[] }
  | { kind: "note"; text: string }
  | { kind: "term"; term: string; definition: string };

export function Blocks({ blocks }: { blocks: Block[] }) {
  return (
    <div className="space-y-3 text-sm leading-relaxed text-gray-600 dark:text-gray-300">
      {blocks.map((block, index) => {
        switch (block.kind) {
          case "p":
            return <p key={index}>{block.text}</p>;

          case "steps":
            return (
              <ol key={index} className="list-decimal space-y-1 pl-5">
                {block.items.map((item, i) => <li key={i}>{item}</li>)}
              </ol>
            );

          case "list":
            return (
              <ul key={index} className="list-disc space-y-1 pl-5">
                {block.items.map((item, i) => <li key={i}>{item}</li>)}
              </ul>
            );

          case "note":
            return (
              <p
                key={index}
                className="rounded-lg border-l-4 border-brand-500 bg-brand-50 p-3 text-gray-700 dark:bg-brand-500/10 dark:text-gray-200"
              >
                {block.text}
              </p>
            );

          case "term":
            return (
              <p key={index}>
                <strong className="text-gray-900 dark:text-white">{block.term}</strong>
                {" — "}
                {block.definition}
              </p>
            );
        }
      })}
    </div>
  );
}

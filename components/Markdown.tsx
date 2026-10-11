import type { ElementType } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

// Each block picks its own direction, so an English paragraph inside a Hebrew
// answer renders LTR; code is always LTR.
function withDir(Tag: ElementType, dir: "auto" | "ltr") {
  return function Dir({ node, ...props }: { node?: unknown }) {
    void node;
    return <Tag dir={dir} {...props} />;
  };
}

const components: Components = {
  p: withDir("p", "auto"),
  h1: withDir("h1", "auto"),
  h2: withDir("h2", "auto"),
  h3: withDir("h3", "auto"),
  h4: withDir("h4", "auto"),
  ul: withDir("ul", "auto"),
  ol: withDir("ol", "auto"),
  blockquote: withDir("blockquote", "auto"),
  table: withDir("table", "auto"),
  pre: withDir("pre", "ltr"),
  code: withDir("code", "ltr"),
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
};

export default function Markdown({ text }: { text: string }) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={components}
        // Images would load from third-party domains, which the phone filter may block.
        disallowedElements={["img"]}
        unwrapDisallowed
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Raw HTML is deliberately not enabled for externally authored source text. */
export function MarkdownBody({ text }: { text: string }) {
  return <div className="min-w-0 break-words text-sm leading-6 [&_h1]:mb-3 [&_h1]:mt-5 [&_h1]:text-lg [&_h1]:font-semibold [&_h2]:mb-2 [&_h2]:mt-4 [&_h2]:font-semibold [&_h3]:mb-2 [&_h3]:mt-4 [&_h3]:font-semibold [&_p]:my-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-1 [&_code]:break-all [&_code]:rounded [&_code]:bg-canvas [&_code]:px-1 [&_pre]:overflow-x-auto [&_pre]:p-3 [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_a]:text-steel [&_a]:underline [&_table]:block [&_table]:overflow-x-auto [&_td]:border [&_td]:border-line [&_td]:px-2 [&_th]:border [&_th]:border-line [&_th]:px-2">
    <Markdown remarkPlugins={[remarkGfm]} skipHtml components={{ a: ({ children, node: _node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer">{children}</a>, img: ({ src, alt }) => typeof src === "string" && src ? <a href={src} target="_blank" rel="noopener noreferrer">{alt || "View image"}</a> : null }}>{text}</Markdown>
  </div>;
}

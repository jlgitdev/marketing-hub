import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";

describe("sanitized Markdown rendering", () => {
  it("renders useful Markdown without executing raw HTML or scripts", () => {
    const html = renderToStaticMarkup(<ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>{"# Event\n\n<script>window.secret='stolen'</script>\n\n[unsafe](javascript:alert(1))"}</ReactMarkdown>);
    expect(html).toContain("<h1>Event</h1>");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("javascript:");
  });
});

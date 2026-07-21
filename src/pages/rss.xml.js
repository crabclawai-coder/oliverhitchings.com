import { posts, site } from "../data/site.js";

const escapeXml = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");

export function GET() {
  const items = posts
    .map(
      (post) => `<item>
    <title>${escapeXml(post.title)}</title>
    <link>${site.url}/blog/${post.slug}/</link>
    <guid>${site.url}/blog/${post.slug}/</guid>
    <pubDate>${new Date(post.date).toUTCString()}</pubDate>
    <description>${escapeXml(post.summary)}</description>
  </item>`,
    )
    .join("\n");

  return new Response(
    `<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0">
  <channel>
    <title>${escapeXml(site.name)}</title>
    <link>${site.url}/</link>
    <description>${escapeXml(site.description)}</description>
    ${items}
  </channel>
</rss>`,
    {
      headers: {
        "Content-Type": "application/rss+xml",
      },
    },
  );
}

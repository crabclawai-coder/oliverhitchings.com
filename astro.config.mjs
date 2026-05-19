import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";

export default defineConfig({
  site: "https://oliverhitchings.com",
  integrations: [
    sitemap({
      filter: (page) => !page.endsWith("/pilot/") && !page.endsWith("/now/"),
    }),
  ],
});

// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { createContactFormController } from "./contact-form.js";

describe("createContactFormController", () => {
  it("exports a callable contact form controller", () => {
    document.body.innerHTML = `
      <form data-contact-form>
        <p data-contact-status></p>
      </form>
    `;

    expect(createContactFormController).toBeTypeOf("function");
  });
});

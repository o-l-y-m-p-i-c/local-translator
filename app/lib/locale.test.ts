import { describe, expect, it } from "vitest";
import {
  computeStatuses,
  flattenLocale,
  localeFilenameFor,
  localeFromFilename,
  mergeLocale,
  validatePlaceholders,
} from "./locale";

describe("locale utilities", () => {
  it("round-trips nested keys including slashes and tildes", () => {
    const source = { general: { "a/b~c": "Hello" }, count: 2 };
    const flat = flattenLocale(source);
    expect(flat).toEqual({ "/general/a~1b~0c": "Hello" });
    expect(mergeLocale(source, { "/general/a~1b~0c": "Bonjour" })).toEqual({
      general: { "a/b~c": "Bonjour" },
      count: 2,
    });
  });

  it("marks missing, stale, and translated leaves", () => {
    expect(
      computeStatuses(
        { "/new": "New", "/changed": "Changed", "/done": "Done" },
        { "/changed": "Modifié", "/done": "Terminé" },
        { "/changed": "Old", "/done": "Done" },
      ),
    ).toEqual({ "/new": "missing", "/changed": "stale", "/done": "translated" });
  });

  it("extracts locale codes from storefront and schema filenames", () => {
    expect(localeFromFilename("locales/en.default.json")).toBe("en");
    expect(localeFromFilename("locales/en.default.schema.json")).toBe("en");
    expect(localeFromFilename("locales/de.schema.json")).toBe("de");
    expect(localeFilenameFor("locales/en.default.json", "fr")).toBe("locales/fr.json");
    expect(localeFilenameFor("locales/en.default.schema.json", "fr")).toBe(
      "locales/fr.schema.json",
    );
  });

  it("detects changed Liquid and interpolation tokens (HTML tags are not protected)", () => {
    const source = "Hi {{ customer.name }} %{count} <strong>{% if ok %}yes{% endif %}</strong>";
    expect(validatePlaceholders(source, source)).toEqual([]);
    // HTML tags can change (text inside attributes is translatable), but Liquid/placeholder tokens must be preserved
    expect(validatePlaceholders(source, "Salut {{ name }} %{count} <b>yes</b>")).toEqual(
      expect.arrayContaining(["{{ customer.name }}", "{{ name }}"]),
    );
    // HTML-only changes are NOT flagged as errors
    expect(validatePlaceholders("<p>Hello</p>", "<b>Bonjour</b>")).toEqual([]);
  });
});

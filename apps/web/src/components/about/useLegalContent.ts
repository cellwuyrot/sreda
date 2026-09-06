```ts
function buildSections(overrides: Record<string, string>): LegalSection[] {
  return LEGAL_SECTIONS.map((section, index) => ({
    title: pick(overrides[legalKeys.sectionTitle(index)], section.title),
    content: pick(overrides[legalKeys.sectionContent(index)], section.content),
  }));
}

/**
 * Объединяет источники правового контента.
 *
 * Приоритет:
 * LEGAL_DEFAULTS / LEGAL_SECTIONS
 * → siteConfig
 * → overrides
 * → blockOverrides
 */
export function mergeLegalOverrides(
  siteContent?: Record<string, string> | null,
  overrides?: Record<string, string> | null,
  blockOverrides?: Record<string, string> | null,
): Record<string, string> {
  const result: Record<string, string> = {};

  const sources = [siteContent, overrides, blockOverrides];

  for (const source of sources) {
    if (!source || typeof source !== "object") {
      continue;
    }

    for (const [key, value] of Object.entries(source)) {
      if (typeof value === "string" && value.trim()) {
        result[key] = value;
      }
    }
  }

  return result;
}

export function resolveLegalContent(
  overrides?: Record<string, string> | null,
): LegalContent {
  const map = overrides ?? {};

  return {
    heading: pick(map[legalKeys.heading], LEGAL_DEFAULTS.heading),
    subheading: pick(
      map[legalKeys.subheading],
      LEGAL_DEFAULTS.subheading,
    ),
    preamble: pick(
      map[legalKeys.preamble],
      LEGAL_DEFAULTS.preamble,
    ),
    contactEmail: pick(
      map[legalKeys.contactEmail],
      LEGAL_DEFAULTS.contactEmail,
    ),
    contactUrl: pick(
      map[legalKeys.contactUrl],
      LEGAL_DEFAULTS.contactUrl,
    ),
    sections: buildSections(map),
  };
}
```

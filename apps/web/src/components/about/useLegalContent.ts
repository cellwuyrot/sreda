"use client";

import { useEffect, useState } from "react";
import {
mergeLegalOverrides,
resolveLegalContent,
type LegalContent,
} from "@/lib/legal";

type Overrides = Record<string, string> | null | undefined;

/**

* Создаёт стабильный ключ из объекта overrides.
*
* Ключ используется только как зависимость useEffect, чтобы объект,
* созданный заново родительским компонентом, не вызывал повторный запрос.
  */
  function keyOf(overrides: Overrides): string {
  if (!overrides) {
  return "";
  }

return JSON.stringify(
Object.keys(overrides)
.sort()
.map((key) => [key, overrides[key]]),
);
}

export function useLegalContent(
/**

* Явно переданные значения siteConfig.
* Если они переданы, дополнительный запрос к API не выполняется.
  */
  overrides?: Overrides,

/**

* Значения блока «Правовая информация».
* Имеют более высокий приоритет, чем siteConfig.
  */
  blockOverrides?: Overrides,
  ): LegalContent {
  const overridesKey = keyOf(overrides);

const [siteContent, setSiteContent] =
useState<Record<string, string> | null>(null);

useEffect(() => {
/**
* Значения были переданы явно — сеть не требуется.
*/
if (overridesKey) {
return;
}

```
let cancelled = false;

fetch("/api/site-content", {
  cache: "no-store",
})
  .then((response) => {
    if (!response.ok) {
      return null;
    }

    return response.json() as Promise<unknown>;
  })
  .catch(() => null)
  .then((data) => {
    if (cancelled) {
      return;
    }

    if (
      data &&
      typeof data === "object" &&
      !Array.isArray(data)
    ) {
      const values: Record<string, string> = {};

      for (const [key, value] of Object.entries(
        data as Record<string, unknown>,
      )) {
        if (typeof value === "string") {
          values[key] = value;
        }
      }

      setSiteContent(values);
    }
  });

return () => {
  cancelled = true;
};
```

}, [overridesKey]);

return resolveLegalContent(
mergeLegalOverrides(
siteContent,
overrides,
blockOverrides,
),
);
}

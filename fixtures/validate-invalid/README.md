Fixture que **debe fallar** en `npm test` (scripts/test-validate.mjs, con `--branch main`).
Cada caso está sembrado a propósito:

- SAFELINKS: press.json#fx-safelinks
- DUPLICATE_URL: press.json#fx-duplicada (misma URL que fx-original)
- MISSING_FIELD: talks.json#fx-sin-institucion
- INVALID_DATE: press.json#fx-fecha-invalida (2024-02-30)
- BROKEN_INTERNAL_LINK: research.json#fx-enlace-roto (/ruta-inexistente)
- SECOND_PERSON: press.json#fx-segunda-persona
- POR_VERIFICAR_MAIN: cualquier [POR VERIFICAR] (p. ej. profile.json)
- PHONE: awards.json#fx-telefono (número ficticio)

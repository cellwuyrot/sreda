# CI lint fix: ConnectionModalFrame ref mutation

## Failure

GitHub Actions failed in `npm run lint` with `react-hooks/refs` at
`apps/web/src/components/connect/overlays/ConnectionModalFrame.tsx:88`:

```tsx
closeRef.current = onClose;
```

The assignment happened during render.

## Fix

The render-time assignment was removed. The latest `onClose` callback is now
copied to the ref in an effect:

```tsx
useEffect(() => {
  closeRef.current = onClose;
}, [onClose]);
```

This effect is declared before the effect that registers the dialog keyboard
listener. The Escape handler continues reading `closeRef.current`, so the event
listener does not need to be recreated whenever `onClose` changes.

## Verification

The affected source was inspected and updated. A full local ESLint run could not
be completed because `npm ci` timed out while npm registry requests failed with
`EAI_AGAIN`. Run the following in CI after dependencies are restored:

```bash
npm ci
npm run lint
```

Do not treat the lint job as passed until GitHub Actions reports success.

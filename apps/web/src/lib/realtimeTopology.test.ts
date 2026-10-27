import { expect, it } from "vitest";
import { assertSingleRealtimeInstance } from "./realtimeTopology";
it("allows one instance and refuses false distributed promises", () => {
  expect(() => assertSingleRealtimeInstance({})).not.toThrow();
  expect(() => assertSingleRealtimeInstance({ REALTIME_REPLICAS: "2" })).toThrow();
  expect(() => assertSingleRealtimeInstance({ NODE_APP_INSTANCE: "1" })).toThrow();
});

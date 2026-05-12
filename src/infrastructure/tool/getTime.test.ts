import { describe, it, expect, vi } from "vitest";
import { GetTime, GetTimeInputSchema } from "@/infrastructure/tool/getTime";
import { createMockState } from "@/testUtils";

describe("GetTime", () => {
    const tool = new GetTime();

    it("has correct name", () => {
        expect(tool.name).toBe("get_time");
    });

    it("has description", () => {
        expect(tool.description).toBe("Get the current date and time.");
    });

    it("returns current time string", async () => {
        vi.useFakeTimers();
        vi.setSystemTime(1000);
        const result = await tool.call(createMockState(), {});
        expect(result.isOk()).toBe(true);
        const value = result._unsafeUnwrap();
        expect(new Date(value).getTime()).toBe(1000);
        vi.useRealTimers();
    });

    it("returns different times for different calls", async () => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
        const result1 = await tool.call(createMockState(), {});
        const time1 = new Date(result1._unsafeUnwrap()).getTime();
        vi.setSystemTime(1000);
        const result2 = await tool.call(createMockState(), {});
        const time2 = new Date(result2._unsafeUnwrap()).getTime();
        expect(time2).toBeGreaterThan(time1);
        vi.useRealTimers();
    });
});

describe("GetTimeInputSchema", () => {
    it("accepts empty object", () => {
        const result = GetTimeInputSchema.safeParse({});
        expect(result.success).toBe(true);
    });

    it("rejects non-empty object", () => {
        const result = GetTimeInputSchema.safeParse({ foo: "bar" });
        expect(result.success).toBe(false);
    });
});

import { describe, it, expect } from "vitest";
import { toCents, validateWithdrawal } from "@/lib/usdt";

describe("USDT withdrawal rules", () => {
  it("rejects below 1 USDT", () => {
    expect(validateWithdrawal("0.99", "10", "123456789")).toMatch(/Minimum/);
  });
  it("rejects above available balance", () => {
    expect(validateWithdrawal("5.01", "5.00", "123456789")).toMatch(/above/);
  });
  it("requires a Binance Pay ID", () => {
    expect(validateWithdrawal("1", "5", "")).toMatch(/Pay ID/);
  });
  it("accepts exactly 1 USDT with enough balance", () => {
    expect(validateWithdrawal("1", "1.00", "123456789")).toBeNull();
  });
  it("uses exact cents", () => {
    expect(toCents("0.1")).toBe(10);
    expect(toCents("1.005")).toBeNull();
  });
});

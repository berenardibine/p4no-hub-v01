import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { useWallet } from "@/hooks/useGrowth";
import { toCents, validateWithdrawal, MIN_WITHDRAW_USDT } from "@/lib/usdt";

type Props = { open: boolean; onOpenChange: (v: boolean) => void; onSubmitted?: () => void };

export const BINANCE_REFERRAL_URL =
  "https://www.binance.com/referral/earn-together/refer2earn-usdc/claim?hl=en&ref=GRO_28502_3Q3LN&utm_medium=web_share_copy&utm_source=referral_entrance";
const NETWORK = "Binance Pay (internal USDT transfer)";

const WithdrawSheet = ({ open, onOpenChange, onSubmitted }: Props) => {
  const { user, profile } = useAuth();
  const { wallet, refresh } = useWallet();
  const [amount, setAmount] = useState("");
  const [payId, setPayId] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);

  const available = String(wallet?.usdt_balance ?? "0");
  const identityOk = profile?.identity_verified;
  const phoneOk = !!profile?.phone_number;
  const err = validateWithdrawal(amount, available, payId);

  const submit = async () => {
    if (!user || err) return;
    setLoading(true);
    try {
      const { error } = await (supabase as any).rpc("usdt_withdrawal_create", {
        _amount: (toCents(amount)! / 100).toFixed(2), _pay_id: payId.trim(),
      });
      if (error) throw error;
      toast.success("Withdrawal request sent. An admin will pay it manually via Binance Pay.");
      onOpenChange(false); setAmount(""); setPayId(""); setConfirming(false);
      await refresh(); onSubmitted?.();
    } catch (e: any) {
      toast.error(e.message || "Failed to submit");
    } finally { setLoading(false); }
  };

  return (
    <Sheet open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) setConfirming(false); }}>
      <SheetContent side="bottom" className="max-h-[92vh] overflow-y-auto">
        <SheetHeader><SheetTitle>Withdraw USDT to Binance</SheetTitle></SheetHeader>
        <div className="space-y-4 py-4">
          {!identityOk && <Alert><AlertDescription>Verify your identity before withdrawing.</AlertDescription></Alert>}
          {!phoneOk && <Alert><AlertDescription>Add a verified phone number before withdrawing.</AlertDescription></Alert>}

          {!confirming ? (
            <>
              <div>
                <Label>Amount (USDT)</Label>
                <Input inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} placeholder={`Min ${MIN_WITHDRAW_USDT} USDT`} />
                <div className="text-xs text-muted-foreground mt-1">Available {Number(available).toFixed(2)} USDT · Minimum {MIN_WITHDRAW_USDT} USDT · Fee 0 USDT</div>
              </div>
              <div>
                <Label>Binance Pay ID (payout destination)</Label>
                <Input inputMode="numeric" value={payId} onChange={e => setPayId(e.target.value.replace(/\D/g, ""))} placeholder="e.g. 123456789" />
                <p className="text-xs text-muted-foreground mt-1">
                  Network: {NETWORK}. Find it in the Binance app → Pay → your Pay ID. Payouts are sent manually by an admin; this is not an automatic transfer.
                  Never share your Binance password, codes or keys with anyone.
                </p>
              </div>
              <Button variant="outline" className="w-full" asChild>
                <a href={BINANCE_REFERRAL_URL} target="_blank" rel="noopener noreferrer">Create a Free Binance Account</a>
              </Button>
              {amount && err && <p className="text-xs text-destructive">{err}</p>}
              <Button className="w-full" size="lg" disabled={!!err || !identityOk || !phoneOk} onClick={() => setConfirming(true)}>
                Continue
              </Button>
            </>
          ) : (
            <>
              <div className="rounded-lg border p-3 space-y-1 text-sm">
                <div>Amount: <b>{(toCents(amount)! / 100).toFixed(2)} USDT</b></div>
                <div>Fee: <b>0.00 USDT</b></div>
                <div>You receive: <b>{(toCents(amount)! / 100).toFixed(2)} USDT</b></div>
                <div>Binance Pay ID: <b className="font-mono">{payId}</b></div>
                <div>Network: {NETWORK}</div>
              </div>
              <p className="text-xs text-muted-foreground">Check the Pay ID carefully. Funds sent to a wrong ID may be lost.</p>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setConfirming(false)} disabled={loading}>Back</Button>
                <Button className="flex-1" onClick={submit} disabled={loading}>{loading ? "Submitting..." : "Confirm withdrawal"}</Button>
              </div>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default WithdrawSheet;

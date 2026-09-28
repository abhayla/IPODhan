/**
 * Zerodha Authorised Person disclosure, required verbatim wherever a Zerodha
 * partner link is shown to a reader (SEBI Feb 2026 social media disclosure
 * circular + Zerodha principal-Member instructions).
 */
export function ZerodhaApDisclosure() {
  return (
    <div className="mx-auto max-w-3xl px-4 text-center text-xs text-gray-500 dark:text-gray-400 space-y-1">
      <p>
        Zerodha Broking Ltd.: SEBI Registration no.: INZ000031633 | Passive Income
        Financial Solutions Private Limited | NSE AP reg. no.: AP2516003693
      </p>
      <p>
        Investments in securities market are subject to market risks, read all the
        related documents carefully before investing.
      </p>
    </div>
  );
}

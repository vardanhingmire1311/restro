import { AppError } from "./errors";

/** OTP delivery. Fast2SMS or Twilio when keys exist. Otherwise the code is printed on the server console. */
export async function sendOtp(mobile: string, code: string) {
  const fast2 = process.env.FAST2SMS_API_KEY;
  if (fast2) {
    const response = await fetch("https://www.fast2sms.com/dev/bulkV2", {
      method: "POST",
      headers: { authorization: fast2, "content-type": "application/json" },
      body: JSON.stringify({ route: "otp", variables_values: code, numbers: mobile, flash: 0 }),
    });
    if (!response.ok) throw new AppError(502, "sms", "Fast2SMS did not accept the OTP. Check the API key.");
    return "fast2sms" as const;
  }
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM;
  if (sid && token && from) {
    const body = new URLSearchParams({ To: `+91${mobile}`, From: from, Body: `Your Restro code is ${code}` });
    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: {
        authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body,
    });
    if (!response.ok) throw new AppError(502, "sms", "Twilio did not accept the OTP. Check the trial credentials.");
    return "twilio" as const;
  }
  console.log(`[otp] mobile ${mobile} code ${code}`);
  return "console" as const;
}

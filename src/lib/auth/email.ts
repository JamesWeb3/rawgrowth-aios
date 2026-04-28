import { Resend } from "resend";

let _client: Resend | null = null;

function client(): Resend {
  if (_client) return _client;
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY missing");
  _client = new Resend(key);
  return _client;
}

function resetEmailHtml(link: string): string {
  // eslint-disable-next-line rawgrowth-brand/banned-tailwind-defaults -- inline box-shadow in email HTML uses brand rgba; not a Tailwind class
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="color-scheme" content="dark" />
    <meta name="supported-color-schemes" content="dark" />
    <title>Reset your Rawgrowth password</title>
  </head>
  <body style="margin:0;padding:0;background-color:#060B08;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">Reset your Rawgrowth password. This link expires in 1 hour.</div>

    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#060B08;padding:48px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" style="max-width:560px;width:100%;">

            <tr>
              <td align="center" style="padding-bottom:28px;">
                <p style="margin:0 0 8px 0;font-size:11px;font-weight:600;letter-spacing:3px;text-transform:uppercase;color:#0CBF6A;">Password Reset</p>
                <h1 style="margin:0;font-size:26px;font-weight:500;letter-spacing:-0.5px;color:rgba(255,255,255,0.92);">Rawgrowth</h1>
              </td>
            </tr>

            <tr>
              <td style="background-color:#0A1210;border:1px solid rgba(255,255,255,0.06);border-radius:14px;padding:40px 40px 36px 40px;">
                <div style="height:1px;width:100%;background:linear-gradient(90deg, rgba(12,191,106,0) 0%, rgba(12,191,106,0.4) 50%, rgba(12,191,106,0) 100%);margin:-40px -40px 32px -40px;width:auto;"></div>

                <h2 style="margin:0 0 14px 0;font-size:22px;font-weight:600;line-height:1.3;color:rgba(255,255,255,0.95);">Reset your password</h2>
                <p style="margin:0 0 28px 0;font-size:15px;line-height:1.6;color:rgba(255,255,255,0.65);">
                  Someone requested a password reset for your Rawgrowth account. If that was you, click the button below to choose a new password.
                </p>

                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                  <tr>
                    <td align="center" style="padding:4px 0 8px 0;">
                      <a href="${link}" style="display:inline-block;background-color:#0CBF6A;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;padding:14px 36px;border-radius:10px;box-shadow:0 4px 14px rgba(12,191,106,0.25);">
                        Reset Password &rarr;
                      </a>
                    </td>
                  </tr>
                </table>

                <div style="height:1px;background-color:rgba(255,255,255,0.06);margin:32px 0 20px 0;"></div>

                <p style="margin:0;font-size:12px;line-height:1.6;color:rgba(255,255,255,0.4);">
                  This link expires in <strong style="color:rgba(255,255,255,0.6);font-weight:600;">1 hour</strong>. If you didn't request this, you can safely ignore this email.
                </p>
              </td>
            </tr>

            <tr>
              <td align="center" style="padding-top:28px;">
                <p style="margin:0;font-size:11px;line-height:1.6;color:rgba(255,255,255,0.3);">
                  Sent by Rawgrowth &middot; Your AI Department
                </p>
              </td>
            </tr>

          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export async function sendPasswordResetEmail(to: string, resetUrl: string) {
  const address = process.env.EMAIL_FROM ?? "noreply@rawgrowth.local";
  const from = address.includes("<") ? address : `Rawgrowth <${address}>`;
  await client().emails.send({
    from,
    to,
    subject: "Reset your Rawgrowth password",
    html: resetEmailHtml(resetUrl),
  });
}

function inviteEmailHtml(params: {
  link: string;
  organizationName: string;
  inviterName: string | null;
  recipientName: string | null;
}): string {
  const inviterLine = params.inviterName
    ? `${params.inviterName} invited you to join`
    : `You've been invited to join`;
  const greeting = params.recipientName ? `Hi ${params.recipientName},` : "Hello,";
  // eslint-disable-next-line rawgrowth-brand/banned-tailwind-defaults -- inline box-shadow in email HTML uses brand rgba; not a Tailwind class
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="color-scheme" content="dark" />
    <title>You're invited to ${params.organizationName} on Rawgrowth</title>
  </head>
  <body style="margin:0;padding:0;background-color:#060B08;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#060B08;padding:48px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" style="max-width:560px;width:100%;">
            <tr>
              <td align="center" style="padding-bottom:28px;">
                <p style="margin:0 0 8px 0;font-size:11px;font-weight:600;letter-spacing:3px;text-transform:uppercase;color:#0CBF6A;">You're Invited</p>
                <h1 style="margin:0;font-size:26px;font-weight:500;letter-spacing:-0.5px;color:rgba(255,255,255,0.92);">Rawgrowth</h1>
              </td>
            </tr>
            <tr>
              <td style="background-color:#0A1210;border:1px solid rgba(255,255,255,0.06);border-radius:14px;padding:40px;">
                <h2 style="margin:0 0 14px 0;font-size:22px;font-weight:600;line-height:1.3;color:rgba(255,255,255,0.95);">${inviterLine} ${params.organizationName}</h2>
                <p style="margin:0 0 20px 0;font-size:15px;line-height:1.6;color:rgba(255,255,255,0.65);">${greeting}</p>
                <p style="margin:0 0 28px 0;font-size:15px;line-height:1.6;color:rgba(255,255,255,0.65);">
                  You've been invited to collaborate with <strong style="color:rgba(255,255,255,0.9);font-weight:600;">${params.organizationName}</strong> on Rawgrowth. Click the button below to set a password and get started.
                </p>
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                  <tr>
                    <td align="center" style="padding:4px 0 8px 0;">
                      <a href="${params.link}" style="display:inline-block;background-color:#0CBF6A;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;padding:14px 36px;border-radius:10px;box-shadow:0 4px 14px rgba(12,191,106,0.25);">
                        Accept Invitation &rarr;
                      </a>
                    </td>
                  </tr>
                </table>
                <div style="height:1px;background-color:rgba(255,255,255,0.06);margin:32px 0 20px 0;"></div>
                <p style="margin:0;font-size:12px;line-height:1.6;color:rgba(255,255,255,0.4);">
                  This invitation expires in <strong style="color:rgba(255,255,255,0.6);font-weight:600;">7 days</strong>. If you weren't expecting this, you can safely ignore it.
                </p>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding-top:28px;">
                <p style="margin:0;font-size:11px;line-height:1.6;color:rgba(255,255,255,0.3);">
                  Sent by Rawgrowth &middot; Your AI Department
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export async function sendInviteEmail(params: {
  to: string;
  inviteUrl: string;
  organizationName: string;
  inviterName: string | null;
  recipientName: string | null;
}) {
  const address = process.env.EMAIL_FROM ?? "noreply@rawgrowth.local";
  const from = address.includes("<") ? address : `Rawgrowth <${address}>`;
  await client().emails.send({
    from,
    to: params.to,
    subject: `You're invited to ${params.organizationName} on Rawgrowth`,
    html: inviteEmailHtml({
      link: params.inviteUrl,
      organizationName: params.organizationName,
      inviterName: params.inviterName,
      recipientName: params.recipientName,
    }),
  });
}

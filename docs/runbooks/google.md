# Runbook: switching on Google Meet and automatic recording upload

**For:** the System Admin (with the Workspace super-admin for steps in the Admin Console).
**When:** before Google Meet is used for live classes, and whenever something on **Ops → Integrations** says "Needs attention".

GLIM ships with both integrations **off**:

- `LIVE_PROVIDER=none`: Lecturers paste a Meet link on each Class Meeting, and online attendance is marked at roll call.
- `VIDEO_HOST=youtube_link`: recordings are uploaded by hand in YouTube Studio and their links pasted in.

Turn each one on only after its steps below are done in **staging** first (TRD Appendix A). Each switch is a change to an App Platform environment variable and a redeploy. Each can be switched off again the same way. Meetings already provisioned keep their Meet link; new ones go back to pasted links.

## Before you start: the spikes

The integration was built against Google's documentation and an in-memory stand-in, not against a real Workspace. Spikes S-01 to S-05, S-08, S-09 and S-Y1 (TRD Appendix B) check the assumptions below against the real services. Record each one in `docs/spikes/S-xx.md`. [`docs/spikes/README.md`](../spikes/README.md) lists what each spike decides in the code.

The two that change the most:

- **S-01** (≈ 45 minutes, no code; TRD Appendix B.1): does Meet report a Gmail participant's Google ID, and is it the same one sign-in sees? Until it passes, leave matching in **review mode**: Lecturers confirm who each online participant is, and the app remembers each Google account for next time.
- **S-Y1 and the YouTube API audit**: uploads from an unaudited Google Cloud project are locked to *private*, so students couldn't watch them. Apply for the audit early; it can take weeks.

## Part 1: Google Meet

### 1. Google Workspace and Cloud (TRD Appendix A.1–A.2)

Do Appendix A.1 and A.2 in full: the host accounts in their own organisational unit, Meet settings, the Cloud project with its APIs, the `glim-meet` service account, the Pub/Sub topic and pull subscription. Then:

1. Base64-encode the service account's JSON key (`base64 -i key.json`) and set it as the **encrypted** App Platform variable `GOOGLE_SA_KEY_JSON_B64`. Delete the downloaded file.
2. Set `GOOGLE_PROJECT_ID`, `GOOGLE_PUBSUB_TOPIC` (`glim-meet-events`) and `GOOGLE_PUBSUB_SUBSCRIPTION` (`glim-meet-events-pull`). Short names are completed with the project ID.
3. Set `LIVE_PROVIDER=google_meet` and redeploy. The app refuses to start if a value is missing, and names the variable (never its value).

### 2. Domain-wide delegation

Open **Ops → Integrations → Google Meet**. Under *For the Admin Console* it shows the service account's **Client ID** and the exact **scopes**. In the Admin Console, go to **Security → API controls → Domain-wide delegation** and add that client ID with exactly those scopes.

### 3. Host accounts

On the same page:

1. Enter the **Workspace domain** (for example `glim.edu.ng`) and save. Host accounts must be on it.
2. **Add** each host account (`lms-host-01@…`, `lms-host-02@…`).
3. Fill in each one's **Google user ID**. In the Admin Console, open the user; the number in the page's address is the ID. The app needs it to receive Meet's events for that account.

### 4. Test

Choose **Test Google**. The test runs in the background and the page updates within a minute. For each host account it checks:

- that the app can act as the account;
- that every delegated scope is granted (a missing one is named);
- the account's Drive storage;
- that an event subscription exists, creating one if needed.

All green means **Working**. Anything else shows what to fix. The same problem is emailed to System Admins once a day while it lasts.

### 5. Matching in review mode (until S-01 passes)

**Settings → Google Meet** holds the `matching` switches. Leave `googleId` and `memberEmail` **off** until S-01 shows they're reliable.

After each class, the Lecturer opens the class's **Attendance** and confirms the people under *In the Google Meet call*. Ticking "Recognise this Google account in later classes" makes later classes match that account on their own. A remembered account is used only for attendance and can never be used to sign in.

## Part 2: automatic recording upload

1. Do Appendix A.4 step 5: an OAuth client with the YouTube scopes, the **YouTube API Services audit**, and a quota big enough for about 5 uploads a day.
2. Set `YOUTUBE_OAUTH_CLIENT_ID`, the encrypted `YOUTUBE_OAUTH_CLIENT_SECRET`, and the encrypted `TOKEN_ENCRYPTION_KEY` (32 random bytes, base64: `openssl rand -base64 32`).
3. Add `https://<app>/api/v1/admin/integrations/youtube/callback` to the OAuth client's redirect URIs.
4. Set `VIDEO_HOST=youtube_api` and redeploy.
5. On **Ops → Integrations → YouTube channel**, choose **Connect the channel**. Sign in as an owner or manager of GLIM's channel and allow access. The app stores the channel's grant encrypted under `TOKEN_ENCRYPTION_KEY`.

From then on, a Meet recording appears under **Settings → Videos** as *Waiting to upload*. It goes through *Uploading* and *YouTube is processing it*, then is published (or left unpublished, per the Recordings policy). It is published only if its length on YouTube matches the original recording, within 2 seconds or 2 %.

Pasting links keeps working. Edits to a recording's title are copied to YouTube. Deleted videos are removed from YouTube when their 7-day undo ends.

**Drive originals are kept** (D-07, `DRIVE_CLEANUP_MODE=NONE`). Only set `TRASH_AFTER_INGEST` if the owner reverses D-07.

## When something goes wrong

| You see | It means | Do |
|---|---|---|
| A Class Meeting card says "Google couldn't create the Meet link"; **Ops** lists a *Google Meet link* failure | Google refused or was down for every retry | Fix what the error names (often a scope or a suspended host account), then **Ask Google again** on the card or **Replay** on Ops. Meanwhile a Lecturer can paste a Meet link; students get that instead. |
| Students see "The class link is being prepared" | The space isn't made yet | They try again in a moment. Close to class time, the app asks Google at once. |
| Students see "Link your Google account" | They have no Google account linked; Google Meet lets them in by it | They use Profile → Link Google. If they can't, the Lecturer admits them from the lobby. |
| Integration says **Needs attention** | A scope is missing, a host account is suspended, or event subscriptions fail | Run **Test Google** and fix what it names. Live classes still work, because joining never calls Google. |
| A host account is "paused after repeated failures" | Google failed 5 times in 30 seconds | Nothing; it tries again every 30 seconds. If it lasts, check Google's status page. |
| A recording shows *The upload failed* | YouTube refused or the quota ran out | **Upload again** under Settings → Videos, or **Replay** on Ops. A spent quota is retried automatically after 6 hours. |
| *The recording is gone from Google Drive* | Someone deleted the file | It can't be uploaded. Ask the Lecturer whether a copy exists and add it by link. |
| The YouTube channel says "YouTube refused the app" | The grant was revoked, or the channel's owner changed | **Connect again**. |
| Email: "Recording storage 85 % full" | A host account's Drive is nearly full | Free space or buy storage. Recordings fail once it's full. |

Meet events can be delayed or lost; the app re-reads Meet every 3 minutes for classes in progress, and every 10 minutes for recently ended conferences' recordings, so missed events correct themselves.

## Rotation

Rotate `GOOGLE_SA_KEY_JSON_B64` at least every 90 days. Create a new key on the service account, update the variable, redeploy, check **Test Google**, then delete the old key. Rotating `TOKEN_ENCRYPTION_KEY` means connecting the YouTube channel again.

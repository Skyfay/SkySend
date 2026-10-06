# File Requests

A file request turns sharing around. You ask someone for files, they upload them in their browser, and only you can open them. The sender needs no account and gets nothing to share in return.

Like everything in SkySend, the files are encrypted before they leave the sender's browser. The server stores ciphertext and never sees a key, a file name or the title you wrote.

## Create a Request

1. Open **Requests** in the navigation
2. Optionally write what you need, for example "Documents for the tax return". The sender sees this text. It is encrypted, and at most 256 bytes long.
3. Choose:
   - **Open for** - How long the request takes uploads, one of the times the instance offers
   - **Uploads** - How many uploads it takes in total
   - **Total size** - How many bytes all uploads may add up to
   - **Password** - Optional. The inbox then opens only with the link and the password together.
4. Click **Create request**

You get two links, and they do very different things.

| Link | Looks like | Who gets it | What it allows |
| --- | --- | --- | --- |
| Upload link | `https://your-instance.com/request/<id>#<key>` | The people who should send you files | Uploading into this request, nothing else |
| Inbox link | `https://your-instance.com/inbox/<id>#<key>` | Only you | Opening, downloading and deleting everything that arrives |

::: danger Keep the inbox link to yourself
The inbox link is the key to every file sent to the request and the only way in. Nobody can recover it, not even the operator of the instance. Save it before you leave the page.
:::

The **Requests** page lists the requests made in this browser, with how many uploads arrived and how long each one stays open. The list lives in this browser only. The server does not know which requests are yours. A request with a password shows no status there, since that needs the password.

## Send Files Into a Request

The sender opens the upload link and sees:

- What you wrote, marked as written by the requester and not checked by anyone
- The host the files go to
- An upload zone with the space that is left

They drop their files, click **Encrypt and send** and see **Delivered** when it is done. There is no share link for them and nothing to keep. When a sender cancels, the slot is given back. An upload that breaks off without a cancel, for example when the connection drops, holds its slot for up to about an hour. One upload may hold several files, which arrive as one zip archive, like a normal multi-file upload.

Every upload is limited by the request and by the instance alike: at most what is left of the total size, at most [`FILE_MAX_SIZE`](/user-guide/configuration/environment-variables#file) and [`FILE_MAX_FILES_PER_UPLOAD`](/user-guide/configuration/environment-variables#file). The upload counts against the sender's own upload quota, if the instance sets one.

## Open the Inbox

Open the inbox link, and enter the password if the request has one. The inbox lists every upload with its name, size, downloads left and when it will be deleted.

- **Download** decrypts the file in your browser. Listing the inbox never counts as a download.
- **Delete** removes one upload. Its slot in the request stays used, so a request never takes more uploads than you allowed.
- **Close request** stops new uploads. Uploads already running still finish.
- **Delete request** removes the request and every file in it.

Every upload is marked **Unverified**. Anyone with the upload link can send files, so open only what you expected. Names are cleaned before they are shown or saved, so a name cannot hide its real extension behind invisible or reordering characters. An upload that cannot be opened is shown as damaged, and the others are not affected.

## What Happens Over Time

| Event | When |
| --- | --- |
| The request stops taking uploads | After the time you chose, at most 7 days, or when you close it |
| An upload is deleted | [`FILE_REQUEST_RETENTION_SEC`](/user-guide/configuration/environment-variables#file-requests) after it arrived, or once its downloads are used up |
| The request itself is deleted | About 75 minutes after the time you chose ran out, once no upload is left in it. Closing it by hand does not bring this forward, deleting it does. |

Each upload can be downloaded [`FILE_REQUEST_DOWNLOADS`](/user-guide/configuration/environment-variables#file-requests) times.

## What the Server Knows

| The server stores | The server never sees |
| --- | --- |
| A random request ID | The key in either link |
| The sealed vault with your private key, which opens only with the inbox link | The public key of the request |
| Three tokens derived from the links, to check who may upload, read and manage | The title in plain text |
| The limits and when the request closes | File names and types |
| For each upload: its size, the ciphertext, the encrypted metadata and the file key wrapped to your public key | Who you are or who sent a file |

The full design is on the [File Requests cryptography page](/developer-guide/crypto/file-requests).

## For Operators

File requests are on by default. Leave `request` out of [`ENABLED_SERVICES`](/user-guide/configuration/environment-variables#services) to turn them off. An instance that already sets `ENABLED_SERVICES` has to add `request` to offer them.

- With [`OIDC_PROTECT_FILES`](/user-guide/configuration/environment-variables#sso-oidc-authentication), creating a request needs a login. Uploading into one never does, the upload link is enough.
- With [`FORCE_FILE_PASSWORD`](/user-guide/configuration/environment-variables#branding-customization), the app asks for a password for every inbox, the same as for every file.
- [`FILE_REQUEST_DAILY_LIMIT`](/user-guide/configuration/environment-variables#file-requests) caps how many requests one person creates per day, counted by OIDC user when creating needs a login and by IP otherwise. The count lives in memory and resets on a restart.
- An abuse report for a file request takes its upload link. The report form refuses inbox links, since their key would open every file sent to the request.
- A wrong inbox password counts toward the same lockout as a wrong file password, [`PASSWORD_MAX_ATTEMPTS`](/user-guide/configuration/environment-variables#password-lockout) per IP.
- Uploads into a request use chunked HTTP, never the WebSocket transport.
- The [admin CLI](/user-guide/admin-cli/commands) lists, counts and deletes requests like uploads and notes.

::: info Things to keep in mind
- Anyone with the upload link can use up the slots of a request. Hand it only to the people you ask.
- The lockout counts per IP. Someone behind the same NAT as you, who knows the request ID from the upload link, can lock your IP out of the inbox for a while by trying wrong passwords.
:::

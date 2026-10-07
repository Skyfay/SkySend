# File Requests

A file request turns sharing around. You ask someone for files or a note, they send them from their browser, and only you can open them. The sender needs no account and gets nothing to share in return.

Like everything in SkySend, what they send is encrypted before it leaves their browser. The server stores ciphertext and never sees a key, a file name, a note or what you wrote into the request.

## Create a Request

1. Open **Request** in the navigation
2. Choose what to ask for: **Files**, a **Note**, or **Both**
3. Optionally write what you need, for example "Documents for the tax return". The sender sees this text. It is encrypted, and at most 256 bytes long.
4. For a note, optionally lay out its fields in the **Note template**, for example a username and a password. Without fields the sender writes freely.
5. Choose:
   - **Open for** - How long the request takes uploads, one of the times the instance offers
   - **Uploads** - How many uploads it takes in total. A note counts as one. For **Both**, this is **Submissions**: one sender's files and note together, which take two uploads of the request.
   - **Size per upload** - How many bytes one upload may have, at most the [`FILE_MAX_SIZE`](/user-guide/configuration/environment-variables#file) of the instance. Only for files.
   - **Password** - Optional. The inbox then opens only with the link and the password together.
6. Click **Create request**

You get two links, and they do very different things.

| Link | Looks like | Who gets it | What it allows |
| --- | --- | --- | --- |
| Upload link | `https://your-instance.com/request/<id>#<key>` | The people who should send you something | Sending into this request, nothing else |
| Inbox link | `https://your-instance.com/inbox/<id>#<key>` | Only you | Opening, downloading and deleting everything that arrives |

::: danger Keep the inbox link to yourself
The inbox link is the key to every file sent to the request and the only way in. Nobody can recover it, not even the operator of the instance. Save it before you leave the page.
:::

**My Links**, tab **Requests**, lists the requests made in this browser, with how many uploads arrived and how long each one stays open. **Go to my requests** under the two links of a new request leads there. The list lives in this browser only. The server does not know which requests are yours. A request with a password shows no status there, since that needs the password.

## Templates

A template keeps the setup of a request for the next one of its kind: what it asks for, the fields of the note and, if you choose, the title and the limits. It never keeps an inbox password, and it never holds a value, only the fields a sender fills in.

- **Start with** above the form fills it in from a template, and **Undo** in the message that follows brings back what you had typed. **Blank** empties it again, and **Built-in** offers templates that come with SkySend, for credentials, an SSH key, a Wi-Fi network and an API key. Everything stays open to change afterwards.
- **Save as template** under the form keeps the current setup. Choose a name, and whether the title and the limits go with it. A name you used before replaces that template.
- **My Links**, tab **Templates**, lists your templates. **Use** starts a request from one, the menu edits, duplicates, exports or deletes it, and **Copy as your own** turns a built-in one into yours.

Templates live in this browser only, like the list of your requests. To move them to another device or browser, **Export** them:

- **As a file** - A `.json` file to keep or carry over
- **As a link** - Everything sits after the `#` of the link, so it never reaches a server. Open it on the other device to import.
- **Encrypt with a password** - Field names like "Bank PIN" tell what a request is about. With a password, the export cannot be read without it.

**Import** reads a file or a link and lists what it found, with what each template asks for. A template with the name of one you have goes in beside it unless you choose to replace it or skip it, since a link can come from anyone. Every imported template is checked like one from a stranger: names and labels are cleaned, values are dropped, and a template that does not fit a request is left out.

## Send Into a Request

The sender opens the upload link and sees:

- What you wrote, marked as written by the requester and not checked by anyone
- The host the files go to
- An upload zone with the size one upload may have, a note to fill in, or both one above the other

A note follows your template: the sender sees your fields with their labels fixed and fills in the values, with a reminder that nobody checked the fields. Without a template the sender writes the note freely, with the same blocks as a normal note. A note can be as large as [`NOTE_MAX_SIZE`](/user-guide/configuration/environment-variables#notes) allows.

For **Both** they have to add files and fill in the note before **Encrypt and send** works, and the two go out as one submission. When the files arrived but the note did not, for example because the connection dropped, the next try only sends the note, as long as the page stays open.

They drop their files or fill in the note, click **Encrypt and send** and see **Delivered** when it is done. There is no share link for them and nothing to keep. When a sender cancels, the slot is given back. An upload that breaks off without a cancel, for example when the connection drops, holds its slot for a while: over WebSocket until it delivered less than 1 MB in 10 minutes, over chunked HTTP for up to about an hour. One upload may hold several files, which arrive as one zip archive, like a normal multi-file upload.

Every upload is limited by the request and by the instance alike: at most the size per upload of the request, at most [`FILE_MAX_SIZE`](/user-guide/configuration/environment-variables#file) and [`FILE_MAX_FILES_PER_UPLOAD`](/user-guide/configuration/environment-variables#file). The upload counts against the sender's own upload quota, if the instance sets one.

## Open the Inbox

Open the inbox link, and enter the password if the request has one. The inbox lists every upload with its name, size, downloads left and when it will be deleted.

- **Download** decrypts the file in your browser. Listing the inbox never counts as a download.
- **Open** shows a note in the page, with **Copy all** and **Save as text**. Opening it counts as one view, so delete a note with a password in it once you read it.
- **Delete** removes one upload. Its slot in the request stays used, so a request never takes more uploads than you allowed.
- **Close request** stops new uploads. Uploads already running still finish.
- **Delete request** removes the request and every file in it.

Every upload is marked **Unverified**. Anyone with the upload link can send files, so open only what you expected. Names are cleaned before they are shown or saved, so a name cannot hide its real extension behind invisible or reordering characters, and every file is saved as plain bytes, whatever type its sender claimed. An upload that cannot be opened is shown as damaged, and the others are not affected. The files and the note of one submission are listed together under **Sent together**. One that arrived since the inbox was last open in this browser is also marked **New**, and a file in a request for notes, or a note in a request for files, is marked **Not asked for**.

## New Uploads

While a SkySend page is visible, the browser checks up to 20 of the newest requests it keeps, every 5 minutes. A dot beside **My Links** in the navigation and on its **Requests** tab, and a count on the request itself, show uploads that its inbox has not shown in this browser yet. Opening the inbox clears them.

- A request with a password is not checked. Its tokens need the password, and the browser keeps none beside the protected link on purpose.
- Nothing new is sent. Each check sends the inbox token that opening the list of requests sends anyway. The server does see the checks, so it learns that the requests checked together belong to one browser, and when that browser is open.
- The pages of share links check nothing. A download, or an upload into someone else's request, never sits right next to a check of your requests.
- A check never forgets a request. Only the list of requests does, once the server no longer has it.
- Nothing is checked while every SkySend tab is closed or hidden, and there are no push notifications. They would need the server to store a push address for each request.

## What Happens Over Time

| Event | When |
| --- | --- |
| The request stops taking uploads | After the time you chose, or when you close it |
| An upload is deleted | [`FILE_REQUEST_RETENTION_SEC`](/user-guide/configuration/environment-variables#file-requests) after it arrived, or once its downloads are used up |
| The request itself is deleted | About 75 minutes after the time you chose ran out, once no upload is left in it. Closing it by hand does not bring this forward, deleting it does. |

Each upload can be downloaded [`FILE_REQUEST_DOWNLOADS`](/user-guide/configuration/environment-variables#file-requests) times.

## What the Server Knows

| The server stores | The server never sees |
| --- | --- |
| A random request ID | The key in either link |
| The sealed vault with your private key, which opens only with the inbox link | The public key of the request |
| Three tokens derived from the links, to check who may upload, read and manage | Your title, what you asked for and your note template |
| The limits and when the request closes | File names and types, and what a note says |
| For each upload: its size, the ciphertext, the encrypted metadata and the file key wrapped to your public key | Who you are or who sent a file |

A note is padded to whole kilobytes, so its size tells little about how long a password in it is. The server can still tell a note from a file by its size and its short metadata.

The full design is on the [File Requests cryptography page](/developer-guide/crypto/file-requests).

## For Operators

File requests are on by default. Leave `request` out of [`ENABLED_SERVICES`](/user-guide/configuration/environment-variables#services) to turn them off. An instance that already sets `ENABLED_SERVICES` has to add `request` to offer them.

- With [`OIDC_PROTECT_FILES`](/user-guide/configuration/environment-variables#sso-oidc-authentication), creating a request needs a login. Uploading into one never does, the upload link is enough.
- A request for a note is part of the `request` service and works when `note` is left out of `ENABLED_SERVICES` too. Its size still follows [`NOTE_MAX_SIZE`](/user-guide/configuration/environment-variables#notes), and the size per upload of the request.
- With [`FORCE_FILE_PASSWORD`](/user-guide/configuration/environment-variables#branding-customization), the app asks for a password for every inbox, the same as for every file.
- [`FILE_REQUEST_DAILY_LIMIT`](/user-guide/configuration/environment-variables#file-requests) caps how many requests one person creates per day, counted by OIDC user when creating needs a login and by IP otherwise. The count lives in memory and resets on a restart.
- An abuse report for a file request takes its upload link. The report form refuses inbox links, since their key would open every file sent to the request.
- A wrong inbox password counts toward the same lockout as a wrong file password, [`PASSWORD_MAX_ATTEMPTS`](/user-guide/configuration/environment-variables#password-lockout) per IP. An inbox without a password never locks, since nobody can guess its 256-bit key.
- One request can take its number of uploads times its size per upload, for example 1000 × 2 GB with the largest settings. Choose [`FILE_REQUEST_MAX_UPLOADS`](/user-guide/configuration/environment-variables#file-requests) and [`FILE_REQUEST_MAX_SIZE`](/user-guide/configuration/environment-variables#file-requests) with that product in mind.
- With `FORCE_FILE_PASSWORD`, the server refuses a request that does not say it has a password. It cannot check the password itself, which never reaches it.
- Uploads into a request take the same transports as normal uploads: WebSocket when [`FILE_UPLOAD_WS`](/user-guide/configuration/environment-variables#file) is on, chunked HTTP otherwise and whenever the WebSocket cannot connect.
- The [admin CLI](/user-guide/admin-cli/commands) lists, counts and deletes requests like uploads and notes.

::: info Things to keep in mind
- Anyone with the upload link can use up the slots of a request. Hand it only to the people you ask.
- The lockout of an inbox with a password counts per IP. Someone behind the same NAT as you, who knows the request ID from the upload link, can lock your IP out of the inbox for a while by trying wrong passwords. A made-up inbox link opened in the browser that created the request asks the server nothing, since that browser knows the real one.
:::

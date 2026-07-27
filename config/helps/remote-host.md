# Remote Host — Your MulmoClaude from Your Phone

The remote host feature lets you use your MulmoClaude from a phone browser at
**https://mulmoserver.web.app** — browse your collections, open mobile custom
views, edit records, and start chats with photos taken on the spot — while the
server keeps running privately on your own computer.

Nothing on your computer is exposed to the internet: no open ports, no public
URL, no tunnels. Phone and server talk through a **cloud message queue**
(Google Firestore): the phone drops a request into your private queue, your
server picks it up, does the work, and drops the answer back. Both directions
happen in real time.

## Connecting

1. On your computer, click the **phone icon** (`phonelink`) in the MulmoClaude
   toolbar and press **Connect**. A Google sign-in popup opens — sign in with
   your Google account. The icon turns green when the host is connected.
2. On your phone, open **https://mulmoserver.web.app** and sign in with the
   **same Google account**. The app shows your host as online and lists what it
   can do.

The two sides find each other purely through the shared Google account — there
is no pairing code and no IP address to type.

The connection lives only as long as the server process: restarting MulmoClaude
drops it, and you reconnect with the same one click. **Disconnect** in the same
popover stops it immediately.

## What You Can Do from the Phone

- **Browse collections** — list your collections and page through their records.
- **Mobile custom views** — open views authored for the phone
  (`target: "mobile"` in a collection's `views[]`; see
  [Remote custom views](config/helps/custom-view-remote.md)). Views can show
  image thumbnails and, where the view allows it, **update or delete records**.
- **Start a chat** — send a message (optionally with a role and **photo
  attachments**) that opens a visible chat session on your computer, as if you
  had typed it there.
- **Browse feeds, shortcuts, and skills** — read-only listings of what the
  workspace offers.

The phone app only shows actions your host actually supports — an older host
simply advertises a shorter menu, so you never tap a button that can't work.

## When the Host Is Online

Everything above works live. The host announces itself once a minute, so the
phone reliably shows it as online and results come back within moments.

## When the Host Is Offline

If your computer is asleep or MulmoClaude isn't connected, the phone shows the
host as **offline**. Browsing (collections, views, feeds) needs a live host and
is unavailable — but **starting a chat still works**:

- The message (and any attached photos) is **queued** in the cloud. The moment
  your host reconnects, it drains the queue — oldest first — and starts the
  chats as if they had just arrived.
- Queued messages **expire after 7 days**. An expired message is deleted
  outright, along with its uploaded photos — it will not surprise you by
  starting a week-old chat.
- The phone lists your pending messages, and you can delete one before the
  host picks it up.

This makes the chat queue a fire-and-forget inbox: jot an idea or snap a
receipt on the go, and it is waiting for your MulmoClaude the next time it
comes online.

## Photos and Attachments

Photos attached to a chat are uploaded to a private staging area (Firebase
Storage) under your account, downloaded into your workspace when the host
handles the message, and then **deleted from the cloud**. Photos belonging to
an expired queued message are deleted too. As a backstop, anything somehow left
behind is automatically swept after 14 days.

## How Secure Is It?

**Your server stays private.** It only makes *outbound* connections to Google's
Firestore — it never listens on a public address, so there is nothing on your
machine for an attacker to scan or reach.

**Everything is scoped to your Google account.** Both the phone and the host
sign in as *you*, and the cloud's security rules restrict each signed-in user
to their own private area — no other user can read your data or send commands
to your host, and your host cannot touch anyone else's data.

**Sign-in is one-shot and in-memory.** Connect passes a short-lived Google
sign-in token from your browser to the server over `localhost` only; it is
used once, never written to a log or to disk. The resulting session lives in
server memory — restarting the server forgets it, and Disconnect ends it on
the spot.

**Mobile views are sandboxed.** A custom view rendered on the phone runs in a
locked-down frame with **all network access disabled** — data reaches it only
through a controlled message channel, so a view (which may be LLM-authored)
cannot leak your data to the outside. Record edits made from a view are
validated and policy-checked by *your host*, not trusted from the phone.

**What passes through the cloud.** Requests, results (record pages, view HTML,
thumbnails), and staged photo uploads transit — and are temporarily stored in —
your private area of a Google Firebase project while in flight. Access is
limited to your account, and the data is deleted as soon as it has been
delivered — the cloud is a relay, not a copy of your workspace.

**The one thing to protect is your Google account.** Anyone who can sign in to
it can command your host with the full capability list above (though never
beyond it — the host only executes its fixed, built-in set of operations).
Use a strong password and two-factor authentication, and Disconnect the host
when you don't need remote access.

## Good to Know

- **Host shows offline right after a restart** — reconnecting is manual by
  design (the sign-in lives in memory). Click the phone icon → Connect.
- **A queued chat used a role that no longer exists** — the message fails with
  an error the phone can display, rather than silently starting the wrong chat.
- **Not the same thing as the MulmoBridge messenger bridges** — Telegram / LINE
  bridges relay *conversations* through a bot; the remote host is a *control
  channel* for collections, views, and chat-starting from the dedicated phone
  app.

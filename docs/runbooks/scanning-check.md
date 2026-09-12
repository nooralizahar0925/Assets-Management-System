# Runbook: checking scanning actually works

The one part of this system a test suite cannot sign off. Everything around the
camera is covered — a decoded value reaching the right asset, the camera being
stopped when the dialog closes, a refused permission still leaving somebody able
to type the tag. What no machine here can check is whether a real lens decodes a
real printed label at the size it comes out of a real printer.

Ten minutes, once, and again whenever the label layout or the tag format
changes.

## Before you start: it must be HTTPS

`getUserMedia` only runs in a secure context. A phone opening the deployment on
a plain `http://192.168.…` address will have its camera refused by the browser
before any of this system's code runs, and the refusal looks exactly like a
denied permission.

`http://localhost` is treated as secure, so this never shows up on the machine
you are developing on. It shows up the first time somebody tries it on a phone.

The app now says which of the three it is — not served over HTTPS, permission
refused, or no camera — so if you see the HTTPS message, that is this, and no
amount of granting permissions will fix it. Use one of:

- the deployment's real HTTPS address;
- a tunnel that terminates TLS (`cloudflared tunnel --url http://localhost:3400`
  or similar);
- a handheld USB scanner, which types the tag and needs no camera at all.

## The check

1. **Print a sheet.** Assets → tick two or three → **Print QR labels**. Do the
   same again with **Print Code 128 labels**. Print both on ordinary paper at
   100% scale — *not* "fit to page", which is what silently shrinks a label
   below what a camera can resolve.

2. **Read one with a plain phone camera**, no app, nothing signed in. A QR label
   carries `https://<your-host>/a/<TAG>` as a deep link, so the phone's own
   camera should offer to open it, and it should land on that asset's page —
   signing in first if nobody is signed in on that phone.

3. **Read one through the app.** Sign in on the phone, open the scan dialog from
   the header, point it at a QR label. The frame turns solid when the camera is
   live. It should resolve to the asset without touching the keyboard.

4. **Read a Code 128 label the same way.** These are the ones that fail first
   when a label is printed too small — the bars need more width than a QR needs
   area.

5. **Try it badly on purpose.** Under a window in daylight, under a desk lamp at
   an angle, and at arm's length. A label that only reads at 10cm dead-on is a
   label a warehouse will give up on.

6. **Type a tag by hand** in the same dialog — `AMS-000123` — and confirm it
   resolves. That path is what everybody falls back to, so it matters most on
   the day the camera is the thing that is broken.

## What counts as a pass

- Both symbologies read, first try, from about 20–30cm, in ordinary light.
- A tag that does not exist says so and names the tag, rather than failing
  silently.
- A wrong or damaged label never resolves to *some other* asset.

## If a label will not read

- **Printed too small or scaled.** Print at 100%. This is the cause almost every
  time.
- **Glossy stock or laminate under a downlight.** Glare defeats any decoder;
  matte labels or a different angle.
- **Code 128 only.** It needs the width — use QR for small labels. The system
  refuses to encode a non-ASCII tag as Code 128 rather than print a label that
  nothing can read, so if a label did print, the tag is not the problem.
- **The camera never starts at all.** Read the message in the dialog — it now
  distinguishes HTTPS, permission and no-camera, and each has a different fix.

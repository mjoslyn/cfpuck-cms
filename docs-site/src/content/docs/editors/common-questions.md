---
title: Common questions
description: "Quick answers when something isn't working as expected: signing in, saving and publishing, pages that don't show, pictures, forms, Compose, events and tickets."
sidebar:
  order: 11
---

## Signing in

### I didn't get my invitation or password email.

1. Check your spam or junk folder, and search your inbox for the site's name.
2. Check you typed the address your account uses. For safety, the site gives the same answer whether or
   not an address has an account.
3. Ask for a new password link on the sign-in screen (**Forgot your password?**, then **Send link**). You
   can ask up to three times an hour.

Password links last an hour and work once; invitations last a week. If yours has run out, ask for a new
one: a password link from the sign-in screen, an invitation from an admin. Only the newest invitation
works. See [Signing in](/editors/#signing-in).

### It says "That email and password don't match an account."

The email address or the password is wrong (capital letters count). Try again carefully, or click
**Forgot your password?** to set a new one. After 10 wrong tries in 15 minutes, the screen says "Too many
tries. Please wait a while and try again later.": wait a while before trying again.

### It says "This account does not have editor access."

You signed in with an account that can't use the admin screens, such as a member's account. Ask an admin
to give your account the editor role (see [People and access](/admins/people/)).

### Why was I signed out?

You stay signed in while you keep using the site, but after seven days without it you are asked to sign
in again. Setting a new password from an emailed link also signs you out everywhere else.

### I can't see Settings or Users.

Those are for admins. Ask an admin to make the change, or to give you the admin role. Admins can find
how in the [Admin guide](/admins/).

### I can't see Events, Tickets, Members or Mailing Lists.

Each of these is a feature an admin turns on under **Settings** (see
[Turning features on](/admins/features/)). **Members** and **Users** are only for admins.

## Saving and publishing

### I changed a page but the website still shows the old version.

1. Did you publish? Saving (including autosave) doesn't change the live site. Open the page and click
   **Publish changes**. In **Content**, a page with edits that aren't live yet is marked **Unpublished
   changes**.
2. Still old? Refresh the page in your browser. Very occasionally it takes up to a minute to show.
3. Still old? You may be looking at another page: click **View live** in the editor to open the page's
   real address.

### What is the difference between a draft and a published page?

- A **Draft** is only visible to you and other editors. Visitors who go to its address see "Not found".
- A **Published** page is on the site for everyone.
- A published page with **Unpublished changes** shows visitors the old version; your edits wait until
  you click **Publish changes**, or **Discard changes** to throw them away.

**Preview** shows what a draft or your unpublished changes will look like. See
[Saving and publishing](/editors/saving-and-publishing/).

### I left the editor. Where did my changes go?

The editor saves a few seconds after each change, so they are almost always kept:

- On a page that isn't published yet, they are in the draft. Open it again from **Content** (try the
  **Drafts** tab).
- On a published page, they are kept aside as **Unpublished changes**. Open the page and click **Publish
  changes** when ready.
- If you chose **Leave without saving** in the **Save your changes?** box, the changes since the last save
  are gone. Earlier saves are still in **Revisions**.

Templates, and pages edited as their template, don't save themselves: only **Save & apply** keeps
changes there.

### Publishing says the address is used by another page.

Pages and posts share addresses (both live at `/<address>/`), so two of them can't have the same one. The
message names the page that has it, for example "The address “news” is used by the post “News”. Choose
another." Change the **Slug** in the page's settings and publish again. The other page may be in the
**Trash**: it keeps its address until it is deleted permanently.

### I can't publish, or Publish opens a box about accessibility.

Your site checks accessibility before publishing. Fix the problems, mark them as checked, or publish
anyway with a reason. See [Accessibility](/editors/accessibility/#when-publishing-waits-for-the-check).

### A bulk Publish skipped some pages.

The message at the top says which and why: an untitled page (give it a title), an address another page
has, or, when your site checks accessibility before publishing, every page (publish those one by one from
the editor, where the check runs).

### The editor says someone else saved this page.

Two people had the page open at once, or you have it open in two tabs. The editor never quietly saves over
someone else's work:

- Autosave stops, and the top says "Not autosaved: someone else saved this since you opened it."
- When you save, a box asks whether to replace their version with yours.

To be safe, click **Cancel** in that box, copy anything you typed that you want to keep, and reload the
page to see their version first. Agree with each other who edits the page.

## Undoing things

### How do I undo a change?

- **Just now, in the editor**: the undo arrow at the top (or Ctrl+Z, Cmd+Z on a Mac). You can undo
  several times, until you leave the editor.
- **From an earlier save**: open **Revisions** on the left of the editor, find the version and click
  **Restore** (see [Going back to an earlier version](/editors/saving-and-publishing/#going-back-to-an-earlier-version)).
  Then **Publish changes**.
- **Unpublished edits to a live page**: **Discard changes** goes back to what is live.
- **A page you published by mistake**: **Unpublish** takes it off the site and keeps it as a draft.

### I deleted something by mistake.

- **A whole page**: click **Content**, the kind of content, then the **Trash** tab. Tick it, choose
  **Restore (as drafts)** in **Bulk actions** and click **Apply**. Then open it and publish it again.
- **Part of a page**: open the page and use undo, or go back to an earlier version in **Revisions**.
- **A template, part or pattern**: click **Content**, **Templates**, then **Restore** beside it in the
  **Trash** at the bottom of the list.
- **An image**: images can't be deleted from **Media**, so it is still there.

Only **Delete permanently**, in the Trash, can't be undone.

### I changed the header (or a template) and every page changed.

That is how templates work: the header, footer and templates are shared by every page that uses them.
If you are still in the editor, use the undo arrow and click **Save & apply** again. Otherwise change it
back by hand and click **Save & apply**. Templates have no revisions to go back to, so take care with them, and
ask an admin if you are unsure. See [The header, footer and templates](/editors/page-editor/#the-header-footer-and-templates).

## Pages that don't show

### I can't find a page I made.

Click **Content**, then the right kind (Pages, Posts, Events...), and try the **Drafts** and **Trash**
tabs. Type a word from its title in the search box and press Enter. The home screen's **Recently
edited** list shows the last things edited.

### A page shows "Not found".

- **It isn't published.** Drafts can't be seen by visitors. Open it and click **Publish** (use
  **Preview** to see it yourself).
- **It is in the Trash.** Restore it (see above).
- **The address is wrong.** Check the **Slug** in the page's settings, or click **View** beside it in
  **Content** to open it at its real address.
- **The address changed before it was published.** Only a published page's old address sends visitors to
  the new one.
- **It is an event, venue or calendar page** and events are turned off, or the calendar pages are turned
  off by an admin. Venues have no page of their own.

Old addresses people still use (from printed flyers, say) can be sent to the right page by an admin (see
[Redirects](/admins/redirects/)).

### A page doesn't appear in a list on the site.

Lists (the **Collection** block, the calendar, menus) only show published content. Check:

- The page is published, not a draft or in the trash.
- It is the kind of content the list shows, with the category or tags the list asks for. Select the
  Collection block in the editor to see its settings.
- The list shows **Featured only** and the page isn't marked **Featured**.
- The list shows a limited number, newest first, and the page is further down.
- It is **Members only**: visitors who aren't members don't see it in lists.
- It is a past event, and the list shows upcoming events only.

### My page doesn't come up in the site's search.

Check that it is published, and that **Leave out of this site's search** isn't ticked in its **SEO**
settings. Search finds words at the start of words in the title, excerpt and text. An admin chooses which
kinds of content search covers.

## Pictures and files

### A picture is cropped badly.

Open it in **Media** and click on the part that matters most, such as a face (see
[Keeping the important part in view](/editors/images-and-files/#keeping-the-important-part-in-view)).
For a **Hero**, **Cover** or cropped **Image** block, you can also set a focal point for each screen size
in the block's settings.

### A picture looks blurry.

It is probably smaller than the space it fills. Upload a larger version of the photo (at least 1600 pixels
wide for big banners) and choose it in place of the old one. In **Media**, a crop marked **this one is
smaller** may look soft on big screens. The site makes the smaller copies for phones itself, so upload the
largest version you have.

### My upload was refused.

Documents can be PDFs, Word, Excel, PowerPoint, OpenDocument, plain text or CSV files, up to 50 MB each.
A file whose name says one thing but which is something else (a web page saved as `.pdf`, say) is
refused. For very large videos, put them on YouTube or Vimeo and use an **Embed** block instead.

## Forms

### I'm not getting emails from a form.

1. Open the form, go to **Notifications**, and check the **Send to** address and that **Send this
   email** is ticked. Click **Save** after any change.
2. Check your spam folder, and add the site's address to your contacts.
3. Check that the form is **Active**.

Everything sent is also kept under **Forms**, **Submissions**, so nothing is lost. An admin can see whether
emails went out in the email log (see [Email log](/admins/email-log-and-backups/#email-log)).

### I'm getting spam through a form.

Forms have a hidden field that catches most robots, and each form takes at most 20 submissions a minute.
If junk still gets through, delete it from **Submissions** (**Delete**), and let your site's admin know.
To stop a form taking answers for a while, untick **Active** on it.

## Compose

### Compose is taking a long time.

Building a page usually takes a minute or two, sometimes longer with long documents. The panel shows
how it is getting on. If Claude stops answering, the panel says "Claude stopped responding before
finishing. Try again." Send your message again; nothing was changed.

### Compose says it is still working, or that I have two turns running.

- "Claude is still working on the last message in this conversation.": wait for the answer before
  sending another.
- "You already have two Compose turns running. Wait for one to finish.": you can run two at once, in
  different conversations.

### Compose says "Claude isn't connected yet".

An admin needs to add Claude's key under **Settings**, **Connections** (see
[Connections](/admins/connections/)). Until then, add and edit pages by hand.

### Compose says the block is too large.

"That block is too large to change in one go." Click a smaller block inside it, such as one section,
and ask again.

### What Claude wrote isn't right.

Ask for the change in plain words ("The date is the 14th, not the 4th"), or change it by hand: later
requests build on your version. Always read the page before publishing, especially dates, prices and
names. See [Writing with Claude](/editors/writing-with-claude/).

## Events and tickets

### My event isn't on the calendar.

Check that it is published and has a date under **Starts**. Past events move to `/events/past/`. A
members-only event only shows to members. If no events show at all, events may be turned off (see
[Events and tickets](/editors/events-and-tickets/)).

### The event shows the wrong time.

Check its **Time zone** in the event's settings: empty uses the site's time zone. If the site's time zone
itself is wrong, an admin changes it under **Settings**, **Events**.

### The booking form doesn't show on an event's page.

- The event isn't published, or isn't attached to a ticket: check **Sells** under **Tickets** in its
  settings.
- The ticket has no ticket types, or none offered: open it under **People**, **Tickets**.
- Sales haven't started or have finished: the page says when tickets go on sale, or that sales have
  closed.

In the editor, a **Tickets** block that can't sell yet shows sample tickets and says why.

### Someone didn't get their ticket confirmation.

Open the ticket under **People**, **Tickets**, find their order (search by name, email or code), click
**Details**, check their email address and click **Resend confirmation**. Ask them to check their spam
folder.

### Someone wants a refund.

Refunds are made by admins, from the order's **Details** on the ticket's page. A free or unpaid order can
be cancelled by any editor with **Cancel order**.

## Something else

### Something else is wrong.

Note what you clicked, what you expected and what you saw (a screenshot helps), with the page's address,
and send it to whoever looks after your site.

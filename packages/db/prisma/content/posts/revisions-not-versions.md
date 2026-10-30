Our posts have revisions, and revisions are never edited. Every save writes a new one. Every restore writes a new one. Nothing that has been saved is ever rewritten.

## Why append-only

A history that can be edited is not a history. If an editor could change an old revision in place, the record of what readers saw on a given day would be whatever someone last decided it was. With append-only revisions, the text that was live on any date is exactly the text that is stored.

The database enforces it. An attempt to update a revision is refused outright, and a revision can only be deleted by deleting the whole post it belongs to.

## Restoring is writing

When an editor restores an old revision, we do not move a pointer back. We write a new revision whose content is the old one, marked as restored from it. The history then reads honestly: here is what changed, and here is when someone decided to undo it.

## Two people at once

Each save names the revision it was based on. If someone else saved in the meantime, the second save is refused with the difference between the two, and the author decides what to keep. Nobody's work is silently overwritten.

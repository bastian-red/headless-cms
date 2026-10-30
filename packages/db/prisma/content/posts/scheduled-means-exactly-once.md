An editor can schedule a post for a time in the future. At that time it should be published once. Not zero times because a process was restarting, and not twice because two processes were running.

## The job is keyed by the revision

When a post is scheduled, a delayed job is queued whose id is the id of the revision being scheduled. The queue refuses a second job with the same id, so scheduling the same revision twice is a no-op.

## Rescheduling replaces

Moving the time removes the old job and queues a new one. Editing the post before it goes out creates a new revision, which needs a new review and a new schedule. The old job finds that its revision is no longer the one scheduled and does nothing.

## Two workers, one publish

We run the test with two publisher processes at once. Both see the job; only one can claim it. The post is published once, and one announcement goes to the website.

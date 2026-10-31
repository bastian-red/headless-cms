An editor can schedule a post for a time in the future. At that time it should be published once. Not zero times because a process was restarting, and not twice because two processes were running.

## The schedule is a row, not a job

Scheduling a post writes two things in one transaction: the post's state becomes scheduled, and the time goes on the post itself. There is no job in a second system that has to agree with the database, so there is nothing to lose when a process restarts and nothing to clean up when plans change.

Every second, the publisher asks the database for scheduled posts whose time has come. It publishes them and writes the announcement to the website in the same transaction, so a published post without its announcement cannot exist, and neither can the reverse.

## Rescheduling is an update

Moving the time is an update to the same row. Editing the post before it goes out creates a new revision and cancels the schedule in the same save, so the editor has to look at it again and schedule again. Nothing can go out that nobody chose.

## Two publishers, one publish

The query that finds due posts locks the rows it takes and skips rows another process already holds. A second publisher running at the same moment does not wait and does not take the same post: it takes the next one, or nothing. Once the first commits, the post is no longer scheduled, so nobody finds it again.

We test exactly that: two publishers run at once against the same due posts, and each post is published once, with one announcement.

## Late, never early

The publisher looks once a second, so a post goes out at most about a second after its time, and never before. Its publication date is the time the editor chose, not the second the publisher noticed. If the publisher stops keeping up, its health check fails as soon as any post is more than a minute overdue.
